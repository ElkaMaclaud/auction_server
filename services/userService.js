import bcrypt from "bcryptjs";
import jwt from 'jsonwebtoken';
import UserModel from "../models/userModel.js"
import dotenv from "dotenv"
import { UnauthorizedException } from "../errors/UnauthorizedException.js"
import { USER_NOT_FOUND_ERROR, WRONG_PASSWORD_ERROR } from "../constants.js";

dotenv.config()
export class UserService {
  async registerUser(dto) {
    const salt = await bcrypt.genSalt(10);
    const today = new Date();
    const birth = new Date(dto.dateofBirth ? dto.dateofBirth : "01.01.1970");
    let age = today.getFullYear() - birth.getFullYear();
    const monthDifference = today.getMonth() - birth.getMonth();
    if (monthDifference < 0 || (monthDifference === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    const newUser = await UserModel.create({
      name: dto.name || "",
      role: dto.role || "user",
      email: dto.email,
      passwordHash: await bcrypt.hash(dto.password, salt),
      typegooseName: "",
    });
    return newUser.save();
  }

  async findUser(email) {
    return UserModel.findOne({ "email": email }).exec();
  }
  async validateUser(
    res,
    email,
    password,
  ) {
    const user = await this.findUser(email);
    if (!user) {
      throw new UnauthorizedException(res, USER_NOT_FOUND_ERROR);
    }
    const isCorrectPassword = await bcrypt.compare(
      password,
      user.passwordHash,
    );
    if (!isCorrectPassword) {
      throw new UnauthorizedException(res, WRONG_PASSWORD_ERROR);
    }
    return user;
  }

  async login(user) {
    const payload = { email: user.email, id: user._id.toString(), role: user.role };
    const { _id, name, email, role  } = user;

    return {
        success: true,
        _id, 
        name, 
        email, 
        role,
        access_token: jwt.sign(payload, process.env.JWT_SECRET),
    };
  }
}
