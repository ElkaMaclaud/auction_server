import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

export default function (req, res, next) {
    if (req.method === "OPTIONS") {
        return next();
    }
    try {
        let token;
        if (req.headers.authorization) {
            token = req.headers.authorization.split(" ")[1];
        }
        if (!token) {
            return res.status(403).json({ message: "Пользователь не авторизован" });
        }
        const decodedData = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decodedData;
        req.userEmail = decodedData.email;
        next();
    } catch (e) {
        console.log(e);
        return res.status(403).json({ message: "Пользователь не авторизован" });
    }
}