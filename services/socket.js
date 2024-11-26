import { Server } from "socket.io";
import dotenv from "dotenv";

dotenv.config();

const auctions = {};
let participants = []
let organizer;
let intervalId;
let timeoutId;

export const createSocketServer = (httpServer) => {
    const io = new Server(httpServer, {
        cors: {
            origin: [process.env.PERMITTED_SOURCES],
            methods: ["GET", "POST"],
            allowedHeaders: ["Content-Type"],
            credentials: true
        }
    });

    io.use((socket, next) => {
        const url = socket.request.url;
        const searchParams = new URLSearchParams(url.split('?')[1]);

        const role = searchParams.get('role');
        const nameCompany = searchParams.get('nameCompany');

        if (role && nameCompany) {
            socket.role = role;
            socket.nameCompany = nameCompany;
            next();
        } else {
            socket.role = "organizer";
            next();
        }
    });

    io.on("connection", (socket) => {
        console.log(`Пользователь подключился: ${socket.id} ${socket.role}`);

        if (socket.role === 'organizer') {
            socket.isOrganizer = true;
            organizer = socket
            // Здесь предполагается, что url отправляется всем по участникам на почту, 
            // но мы генерируем их тут и отправляем организатору
            const companyes = ["OOO Энерготорг", "ИП Фарма", "OOO УРРГ", "OOO Газнефть"]
            const participantsUrl = Array.from({ length: 4 }, (_, index) =>
                `${process.env.PERMITTED_SOURCES}/auction?id=${Math.random().toString(36).substring(2, 15)}&nameCompany=${companyes[index]}&role=user`)

            io.to(organizer.id).emit("participantsUrl", participantsUrl)

            socket.on("add participantsUrl", (participantsUrl) => {
                const participantsUrlList = participantsUrl.split(",").map(company => company.trim()).filter(company => company !== "");
                const uniqueCompanies = participantsUrlList.filter(company => !companyes.includes(company));
                companyes.push(...uniqueCompanies)
                const participantsUrlAdd = Array.from({ length: companyes.length }, (_, index) =>
                    `${process.env.PERMITTED_SOURCES}/auction?id=${Math.random().toString(36).substring(2, 15)}&nameCompany=${companyes[index]}&role=user`)
                io.to(organizer.id).emit("participantsUrl", participantsUrlAdd)
            })

            socket.on("start auction", (auctionId) => {
                if (!socket.isOrganizer) return;
                auctions[auctionId] = {
                    participants,
                    // auctionEndTime: Date.now() + 15 * 60 * 1000
                };

                auctions[auctionId].participants.forEach((participant, index) => {
                    participant.currentBid = 0;
                    participant.turnEndTime = 0;
                    participant.active = index === 0;
                });

                participants.forEach(i => io.to(i.socket).emit("auction started", auctionId, auctions[auctionId].participants));
                io.to(organizer.id).emit("auction started", auctionId, auctions[auctionId].participants)
                console.log(`Аукцион начат`, auctionId);
                timeoutId = setTimeout(() => {
                    endAuction(auctionId)
                }, 15 * 60 * 1000)
                startTurn(auctionId);
            });
        } else {
            if (!participants.find(i => i.nameCompany === socket.nameCompany)) {
                addParticipant(participants, socket)
            }
            if (Object.keys(auctions).length > 0) {
                const auctionId = Object.keys(auctions)[0]
                if (!auctions[auctionId].participants.find(i => i.nameCompany === socket.nameCompany)) {
                    if (auctions[auctionId].participants.length === 0) {
                        addParticipant(auctions[auctionId].participants, socket, true)
                    } else {
                        addParticipant(auctions[auctionId].participants, socket)
                    }
                }
                io.to(socket.id).emit("auction started", auctionId, auctions[auctionId].participants)
                socket.join(socket.id);

            }

        }
        participants.forEach(i => io.to(i.socket).emit("participants updated", { participants }));
        if (organizer) { io.to(organizer.id).emit("participants updated", { participants }) }

        socket.on("end auction", (auctionId) => {
            endAuction(auctionId)
        })

        socket.on("join auction", (auctionId) => {
            const auction = auctions[auctionId];
            if (!auction) {
                socket.emit("error", "Аукцион не найден.");
                return;
            }

            // if (auction.participants.length >= 50) {
            //     socket.emit("error", "Максимальное количество участников достигнуто.");
            //     return;
            // }

            if (socket.role !== "organizer" && !auction.participants.find(i => i.nameCompany === socket.nameCompany)) { //!auction.participants.some(i => i.socket === socket.id)
                addParticipant(auction.participants, socket)
            }
            socket.join(socket.id);
            console.log(`Пользователь ${socket.id} присоединился к аукциону`);
        });

        socket.on("turn timeout", (participant, auctionId) => {
            console.log("Переход хода", auctionId)
            try {
                handleTurnTimeout(auctions[auctionId], participant, auctionId);
            } catch (error) {
                console.log(error)
            }
        })

        socket.on("place bid", (bidAmount, auctionId, participant) => {
            const auction = auctions[auctionId];
            if (!auction) return;

            const currentBidder = auction.participants.find(particip => particip.socket === participant.socket);
            if (!currentBidder) return;

            currentBidder.currentBid = parseInt(bidAmount);
        });

        socket.on("disconnect", () => {
            console.log("Пользователь отключился:", socket.id);
            participants = participants.filter(participant => participant.socket !== socket.id);
            for (const auctionId in auctions) {
                const auction = auctions[auctionId];
                if (auction) {
                    const leavingParticipant = auction.participants.find(i => i.socket === socket.id)
                    if (leavingParticipant && leavingParticipant.active) {
                        console.log("Переход хода", auctionId)
                        try {
                            if (intervalId) {
                                clearInterval(intervalId);
                            }
                            handleTurnTimeout(auctions[auctionId], leavingParticipant, auctionId);
                        } catch (error) {
                            console.log(error)
                        }
                    }
                    auction.participants = auction.participants.filter(participant => participant.socket !== socket.id);
                }
            } 
            participants.forEach(i => io.to(i.socket).emit("participants updated", { participants }));
            io.to(organizer.id).emit("participants updated", { participants })
        });
    });

    const startTurn = (auctionId) => {
        const auction = auctions[auctionId];
        if (!auction) return;

        try {
            if (auction.participants.length) {
                let currentBidder = auction.participants.find(participant => participant.active);
                currentBidder.turnEndTime = Date.now() + 31 * 1000;

                io.to(currentBidder.socket).emit("your turn", {
                    participant: currentBidder,
                    message: "Ваш ход! У вас есть 30 секунд для ставки."
                });
                updateAllParticipants(auction, 30);

                const executeIntervalWork = () => {
                    const remainingTime = Math.max(0, Math.floor((currentBidder.turnEndTime - Date.now()) / 1000));
                    updateAllParticipants(auction, remainingTime);
                    if (remainingTime === 0) {
                        clearInterval(intervalId);
                        handleTurnTimeout(auction, currentBidder, auctionId);
                    }
                };
                if (intervalId) {
                    clearInterval(intervalId);
                }
                intervalId = setInterval(executeIntervalWork, 1000);
            } else {
                console.log("Нет ни одного участника")
            }
        } catch (error) {
            console.log(error);
        }
    };

    const handleTurnTimeout = (auction, currentBidder, auctionId) => {
        const currentBidderIndex = auction.participants.findIndex(i => i.socket === currentBidder.socket);
        const nextBidderIndex = (currentBidderIndex + 1) % auction.participants.length;

        try {
            const nextBidder = auction.participants[nextBidderIndex];

            auction.participants.forEach(participant => participant.active = false);
            if (nextBidder) nextBidder.active = true;

            io.to(nextBidder.socket).emit("turn timeout", {
                message: "Время вышло! Ход переходит к следующему участнику.",
                currentBidder: nextBidder.socket
            });

            startTurn(auctionId);
        } catch (error) {
            console.log(error);
        }
    };

    const updateAllParticipants = (auction, num, participants = auction.participants) => {
        participants.forEach(participant => {
            io.to(participant.socket).emit("participants updated", {
                participants,
                ...(num !== undefined && { remainingTime: num })
            });
        });
        if (organizer) {
            io.to(organizer.id).emit("participants updated", {
                participants,
                ...(num !== undefined && { remainingTime: num })
            });
        }
    };
    const endAuction = (auctionId) => {
        if (timeoutId) {
            clearTimeout(timeoutId)
        }
        try {
            if (auctions[auctionId]) {
                auctions[auctionId].participants.forEach(participant => participant.active = false);
                delete auctions[auctionId]
            }
            participants.forEach(i => io.to(i.socket).emit("auction ended"));
            if (organizer) { io.to(organizer.id).emit("auction ended") }
        } catch (error) {
            console.log(error)
        }
    }

    const addParticipant = (list, socket, active = false) => {
        list.push(({
            availability: "-",
            term: 80,
            warrantyObligations: 24,
            paymentTerms: "30%",
            socket: socket.id,
            nameCompany: socket.nameCompany,
            currentBid: 0,
            turnEndTime: 0,
            active
        }))
    }

}