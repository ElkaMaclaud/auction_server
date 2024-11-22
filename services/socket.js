import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const auctions = {};
let participants = []
let organizer;

export const createSocketServer = (httpServer) => {
    const io = new Server(httpServer, {
        cors: {
            origin: ["http://localhost:3000"],
            methods: ["GET", "POST"],
            allowedHeaders: ["Authorization", "Content-Type"],
            credentials: true
        }
    });

    io.use((socket, next) => {
        const jwtToken = socket.handshake.headers['authorization'];
        if (jwtToken) {
            const token = jwtToken.split(" ")[1];
            jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
                if (err) {
                    return next(new Error('Unauthorized'));
                }
                socket.userId = decoded.id;
                socket.userEmail = decoded.email
                socket.role = decoded.role;
                next();
            });
        } else {
            next(new Error('Unauthorized'));
        }
    });

    io.on("connection", (socket) => {
        console.log(`Пользователь подключился: ${socket.id} ${socket.role} ${socket.userEmail}`);

        if (socket.role === 'organizer') {
            socket.isOrganizer = true;
            organizer = socket

            socket.on("start auction", (auctionId) => {
                if (!socket.isOrganizer) return;
                auctions[auctionId] = {
                    participants,
                    auctionActive: true,
                    auctionEndTime: Date.now() + 15 * 60 * 1000
                };

                auctions[auctionId].participants.forEach((participant, index) => {
                    participant.currentBid = 0;
                    participant.turnEndTime = 0;
                    participant.active = index === 0;
                });

                participants.forEach(i => io.to(i.socket).emit("auction started", auctionId, auctions[auctionId].participants));
                io.to(organizer.id).emit("auction started", auctionId, auctions[auctionId].participants)
                console.log(`Аукцион начат`, auctionId);
                startTurn(auctionId);
            });
        } else {
            if (!participants.find(i => i.email === socket.userEmail)) {
                participants.push({
                    availability: "-",
                    term: 80,
                    warrantyObligations: 24,
                    paymentTerms: "30%",
                    socket: socket.id,
                    email: socket.userEmail,
                    currentBid: 0,
                    turnEndTime: 0,
                    active: false
                });
            }
            if (Object.keys(auctions).length > 0) {
                const auctionId = Object.keys(auctions)[0]
                if (!auctions[auctionId].participants.find(i => i.email === socket.userEmail)) {
                    auctions[auctionId].participants.push(({
                        availability: "-",
                        term: 80,
                        warrantyObligations: 24,
                        paymentTerms: "30%",
                        socket: socket.id,
                        email: socket.userEmail,
                        currentBid: 0,
                        turnEndTime: 0,
                        active: false
                    }))
                } 
                io.to(socket.id).emit("auction started", auctionId, auctions[auctionId].participants)
                socket.join(socket.id);
            }
        }
        participants.forEach(i => io.to(i.socket).emit("participants updated", { participants }));
        if (organizer) { io.to(organizer.id).emit("participants updated", { participants }) }

        socket.on("end auction", (auctionId) => {
            auctions[auctionId].participants.forEach(participant => participant.active = false);
            delete auctions[auctionId]
            participants.forEach(i => io.to(i.socket).emit("auction ended"));
            if (organizer) { io.to(organizer.id).emit("auction ended") }
        })

        socket.on("join auction", (auctionId) => {
            const auction = auctions[auctionId];
            if (!auction) {
                socket.emit("error", "Аукцион не найден.");
                return;
            }

            if (auction.participants.length >= 6) {
                socket.emit("error", "Максимальное количество участников достигнуто.");
                return;
            }

            if (socket.role !== "organizer" && !auction.participants.find(i => i.socket === socket.id)) { //!auction.participants.some(i => i.socket === socket.id)
                auction.participants.push({
                    socket: socket.id,
                    availability: "-",
                    term: 80,
                    warrantyObligations: 24,
                    paymentTerms: "30%",
                    email: socket.userEmail,
                    currentBid: 0,
                    turnEndTime: 0,
                    active: false
                });
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
            if (!auction || !auction.auctionActive) return;

            const currentBidder = auction.participants.find(particip => particip.socket === participant.socket);
            // if (!currentBidder || currentBidder.currentBid >= bidAmount) return; 
            currentBidder.currentBid = parseInt(bidAmount);
        });

        socket.on("disconnect", () => {
            console.log("Пользователь отключился:", socket.id);
            participants = participants.filter(participant => participant.socket !== socket.id);
            for (const auctionId in auctions) {
                const auction = auctions[auctionId];
                if (auction) {
                    auction.participants = auction.participants.filter(participant => participant.socket !== socket.id);
                }
                participants.forEach(i => io.to(i.socket).emit("participants updated", { participants }));
                io.to(organizer.id).emit("participants updated", { participants })
            }
        });
    });
    let intervalId;

    const startTurn = (auctionId) => {
        const auction = auctions[auctionId];
        if (!auction || !auction.auctionActive) return;

        try {
            const currentBidder = auction.participants.find(participant => participant.active);
            currentBidder.turnEndTime = Date.now() + 31 * 1000;

            io.to(currentBidder.socket).emit("your turn", {
                participant: currentBidder,
                message: "Ваш ход! У вас есть 30 секунд для ставки."
            });
            updateAllParticipants(auction, 30);

            const executeIntervalLogic = () => {
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
            intervalId = setInterval(executeIntervalLogic, 1000);
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
                participants: auction.participants,
                ...(num !== undefined && { remainingTime: num })
            });
        }
    };

}