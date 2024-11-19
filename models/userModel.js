import { Schema, model } from "mongoose"


const UserModel = new Schema({
    name: { type: String, required: false },
    email: { type: String, required: true, unique: true },
    role: { type: String, enum: ["organizer", "user"], required: true },
    passwordHash: { type: String, required: true },
}, { timestamps: true });


export default model('User', UserModel, 'User');