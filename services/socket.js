import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

export const activeSockets = {};
const auctions = {};
let participantsAuction = []
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
                activeSockets[socket.userId] = socket;
                next();
            });
        } else {
            next(new Error('Unauthorized'));
        }
    });

    io.on("connection", (socket) => {
        console.log(`Пользователь подключился: ${socket.id} ${socket.role}`)
        if (socket.role === 'organizer') {
            socket.isOrganizer = true;

            socket.on("start auction", (auctionId) => {
                if (!socket.isOrganizer) return;

                auctions[auctionId] = {
                    participants: participantsAuction,
                    currentBid: 0,
                    currentBidderIndex: 0,
                    auctionActive: true,
                    auctionEndTime: Date.now() + 15 * 60 * 1000,
                    turnEndTime: Date.now() + 30 * 1000
                };
                participantsAuction.forEach(i => io.to(i.socket).emit("auction started", auctionId, auctions[auctionId].participants))
                console.log(`Auction started`, auctionId);
                startTurn(auctionId);
            });
        } else {
            participantsAuction.push({ socket: socket.id, email: socket.userEmail, active: false,  })
        }

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
                auction.participants.push({ socket: socket.id, email: socket.userEmail });
            }
            socket.join(socket.id);
            auction.participants.forEach(i => io.to(i.socket).emit("participants updated", auction.participants))
            // io.to(auctionId).emit("participants updated", auction.participants);
            console.log(`Пользователь ${socket.id} присоединился к аукциону`);
        });

        socket.on("place bid", (bidAmount) => {
            const auction = auctions[socket.id];
            if (!auction || !auction.auctionActive) return;

            const currentBidder = auction.participants[auction.currentBidderIndex];
            if (socket.id !== currentBidder.socket) return;

            auction.currentBid = bidAmount;
            auction.currentBidderIndex = (auction.currentBidderIndex + 1) % auction.participants.length;

            auction.turnEndTime = Date.now() + 30 * 1000;

            io.to(socket.id).emit("new bid", {
                bidAmount,
                currentBidder: auction.participants[auction.currentBidderIndex]?.socket,
                auction
            });

            if (Date.now() >= auction.auctionEndTime) {
                auction.auctionActive = false;
                io.to(socket.id).emit("auction ended", auction);
            } else {
                startTurn(socket.id);
            }
        });

        socket.on("disconnect", () => {
            console.log("Пользователь отключился:", socket.id);
            delete activeSockets[socket.id];
            for (const auctionId in auctions) {
                const auction = auctions[auctionId];
                auction.participants = auction.participants.filter(participant => participant.socket !== socket.id);
                participantsAuction = auction.participants.filter(participant => participant.socket !== socket.id);
                io.to(auctionId).emit("participants updated", auction.participants);
            }
        });
    });

    const startTurn = (auctionId) => {
        const auction = auctions[auctionId];
        if (!auction || !auction.auctionActive) return;

        const currentBidder = auction.participants[auction.currentBidderIndex];
        io.to(currentBidder?.socket).emit("your turn", {
            message: "Ваш ход! У вас есть 30 секунд для ставки.",
            currentBid: auction.currentBid
        });

        setTimeout(() => {
            if (auction.auctionActive) {
                auction.currentBidderIndex = (auction.currentBidderIndex + 1) % auction.participants.length;
                io.to(auctionId).emit("turn timeout", {
                    message: "Время вышло! Ход переходит к следующему участнику.",
                    currentBidder: auction.participants[auction.currentBidderIndex]?.socket
                });
                startTurn(auctionId);
            }
        }, 30000);
    };
};
