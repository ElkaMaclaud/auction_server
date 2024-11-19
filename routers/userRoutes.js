import express from "express";
import { UserController } from "../controllers/userController.js"; 
import  auth  from "../middlewares/authMiddleware.js"; 

const router = express.Router();
const userController = new UserController();

router.post("/auth/register", (req, res) => userController.register(req, res));
router.post("/auth/login", (req, res) => userController.login(req, res));

export default router;