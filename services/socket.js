import { Server } from "socket.io";
import dotenv from "dotenv";

dotenv.config();

export const activeSockets = {};
const auctions = {}; 

export const createSocketServer = (httpServer) => {
    const io = new Server(httpServer, {
        cors: {
            origin: "*",
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
                socket.role = decoded.role;
                activeSockets[socket.userId] = socket;
                next();
            });
        } else {
            next(new Error('Unauthorized'));
        }
    });

    io.on("connection", (socket) => {
        console.log(`Пользователь подключился: ${socket.id}`);

        socket.on("register as organizer", () => {
            if (socket.role === 'organizer') { 
                socket.isOrganizer = true;
                console.log(`Пользователь ${socket.userId} зарегистрирован как организатор`);
            }
        });

        socket.on("start auction", (auctionId, participants) => {
            if (!socket.isOrganizer) return; 

            auctions[auctionId] = {
                participants,
                currentBid: 0,
                currentBidderIndex: 0,
                auctionActive: true,
                auctionEndTime: Date.now() + 15 * 60 * 1000,
                turnEndTime: Date.now() + 30 * 1000 
            };
            io.to(auctionId).emit("auction started", auctions[auctionId]);
            startTurn(auctionId); 
        });

        socket.on("end auction", (auctionId) => {
            if (!socket.isOrganizer) return; 

            const auction = auctions[auctionId];
            if (auction) {
                auction.auctionActive = false;
                io.to(auctionId).emit("auction ended", auction);
            }
        });

        socket.on("place bid", (auctionId, bidAmount) => {
            const auction = auctions[auctionId];
            if (!auction || !auction.auctionActive) return;

            const currentBidder = auction.participants[auction.currentBidderIndex];
            if (socket.id !== currentBidder) return; 

            auction.currentBid = bidAmount;
            auction.currentBidderIndex = (auction.currentBidderIndex + 1) % auction.participants.length;

            auction.turnEndTime = Date.now() + 30 * 1000;

            io.to(auctionId).emit("new bid", {
                bidAmount,
                currentBidder: auction.participants[auction.currentBidderIndex],
                auction
            });

            if (Date.now() >= auction.auctionEndTime) {
                auction.auctionActive = false;
                io.to(auctionId).emit("auction ended", auction);
            } else {
                startTurn(auctionId); 
            }
        });

        socket.on("disconnect", () => {
            console.log("Пользователь отключился:", socket.id);
            delete activeSockets[socket.id];
        });
    });

    const startTurn = (auctionId) => {
        const auction = auctions[auctionId];
        if (!auction || !auction.auctionActive) return;

        const currentBidder = auction.participants[auction.currentBidderIndex];
        io.to(currentBidder).emit("your turn", {
            message: "Ваш ход! У вас есть 30 секунд для ставки.",
            currentBid: auction.currentBid
        });

        setTimeout(() => {
            if (auction.auctionActive) {
                auction.currentBidderIndex = (auction.currentBidderIndex + 1) % auction.participants.length;
                io.to(auctionId).emit("turn timeout", {
                    message: "Время вышло! Ход переходит к следующему участнику.",
                    currentBidder: auction.participants[auction.currentBidderIndex]
                });
                startTurn(auctionId); 
            }
        }, 30000); 
    };
};