import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import mongoose from "mongoose"
import userRouter from "./routers/userRoutes.js"
import { createSocketServer } from "./services/socket.js"


dotenv.config()
const PORT = process.env.PORT || 5000

const app = express()

app.use(cors())
app.use(express.json())

const start = (async () => {
    try {
        const server = app.listen(PORT, () => console.log(`Сервер запущен на порте ${PORT}`))
        createSocketServer(server)
    } catch (error) {
        console.log(`Что-то пошло не так: ${error}`)
    }
})

start()