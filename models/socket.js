import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const auctions = {};
let participantsAuction = []
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
        console.log(`Пользователь подключился: ${socket.id} ${socket.role}`);
        
        if (socket.role === 'organizer') {
            socket.isOrganizer = true;
            organizer = socket
    
            socket.on("start auction", (auctionId) => {
                if (!socket.isOrganizer) return;
                auctions[auctionId] = {
                    participants: participantsAuction,
                    auctionActive: true,
                    auctionEndTime: Date.now() + 15 * 60 * 1000
                };

                participantsAuction.forEach((participant, index) => {
                    participant.currentBid = 0; 
                    participant.turnEndTime = Date.now() + 30 * 1000; 
                    participant.active = index === 0; 
                });
  
                participantsAuction.forEach(i => io.to(i.socket).emit("auction started", auctionId, auctions[auctionId].participants));
                io.to(organizer.id).emit("auction started", auctionId, auctions[auctionId].participants)
                console.log(`Аукцион начат`, auctionId);
                startTurn(auctionId);
            });
        } else {
            participantsAuction.push({ 
                socket: socket.id, 
                email: socket.userEmail, 
                currentBid: 0, 
                turnEndTime: Date.now() + 30 * 1000,
                active: false 
            });
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
            io.to(organizer.id).emit("participants updated", auction.participants);
            console.log(`Пользователь ${socket.id} присоединился к аукциону`);
        });

        socket.on("place bid", (bidAmount) => {
            const auction = auctions[socket.id];
            if (!auction || !auction.auctionActive) return;
        
            const currentBidder = auction.participants.find(participant => participant.socket === socket.id);
            // if (!currentBidder || currentBidder.currentBid >= bidAmount) return; 
        
            currentBidder.currentBid = bidAmount;
        
            // const nextBidderIndex = (auction.participants.indexOf(currentBidder) + 1) % auction.participants.length;
            // const nextBidder = auction.participants[nextBidderIndex];
        
            io.emit("new bid", {
                bidAmount,
                currentBidder: currentBidder.socket,
                nextBidder: nextBidder.socket,
                auction
            });
        
            if (Date.now() >= auction.auctionEndTime) {
                auction.auctionActive = false;
                io.emit("auction ended", auction);
            } else {
                startTurn(nextBidder.socket); 
            }
        });

        socket.on("disconnect", () => {
            console.log("Пользователь отключился:", socket.id);
            for (const auctionId in auctions) {
                const auction = auctions[auctionId];
                auction.participants = auction.participants.filter(participant => participant.socket !== socket.id);
                participantsAuction = auction.participants.filter(participant => participant.socket !== socket.id);
                auction.participants.forEach(i => io.to(i.socket).emit("participants updated", auction.participants));
                io.to(organizer.id).emit("participants updated", auction.participants)
            }
        });
    });

    const startTurn = (auctionId) => {
        const auction = auctions[auctionId];
        if (!auction || !auction.auctionActive) return;
    
        const currentBidder = auction.participants.find(participant => participant.active);
        if (!currentBidder) {
            const firstBidder = auction.participants[0];
            if (firstBidder) {
                firstBidder.active = true;
                firstBidder.turnEndTime = Date.now() + 30 * 1000; 
                console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!firstBidder",firstBidder)
                io.to(firstBidder.socket).emit("your turn", {
                    message: "Ваш ход! У вас есть 30 секунд для ставки."    
                });
                auction.participants.forEach(i => io.to(i.socket).emit("participants updated", auction.participants));
                io.to(organizer.id).emit("participants updated", auction.participants);
                return; 
            }
            return; 
        }
    
        currentBidder.turnEndTime = Date.now() + 30 * 1000;
        console.log("//////////////////////////currentBidder", currentBidder)
        io.to(currentBidder.socket).emit("your turn", {
            message: "Ваш ход! У вас есть 30 секунд для ставки."
        });
        auction.participants.forEach(i => io.to(i.socket).emit("participants updated", auction.participants));
        io.to(organizer.id).emit("participants updated", auction.participants);
    
        const updateParticipants = () => {
            const remainingTime = Math.max(0, Math.floor((currentBidder.turnEndTime - Date.now()) / 1000));
            console.log("//////////////////////////currentBidder", remainingTime)
            auction.participants.forEach(participant => {
                io.to(participant.socket).emit("participants updated", {
                    remainingTime
                });
            });
            io.to(organizer.id).emit("participants updated", auction.participants);
        };
    
        const intervalId = setInterval(() => {
            updateParticipants();
            if (Date.now() >= currentBidder.turnEndTime) {
                clearInterval(intervalId); 
                handleTurnTimeout(auction, currentBidder, auctionId);
            }
        }, 1000); 
    
        auction.participants.forEach(i => io.to(i.socket).emit("participants updated", auction.participants));
        io.to(organizer.id).emit("participants updated", auction.participants);
    };
    
    const handleTurnTimeout = (auction, currentBidder, auctionId) => {
        const nextBidderIndex = (auction.participants.indexOf(currentBidder) + 1) % auction.participants.length;
        const nextBidder = auction.participants[nextBidderIndex];
    
        auction.participants.forEach(participant => participant.active = false);
        if (nextBidder) nextBidder.active = true;
    
        io.to(nextBidder.socket).emit("turn timeout", {
            message: "Время вышло! Ход переходит к следующему участнику.",
            currentBidder: nextBidder.socket
        });
        auction.participants.forEach(i => io.to(i.socket).emit("participants updated", auction.participants));
        io.to(organizer.id).emit("participants updated", auction.participants);
    
        nextBidder.turnEndTime = Date.now() + 30 * 1000; 
        startTurn(auctionId); 
    };
    
}