import { UserService } from "../services/userService.js";
import { ALREADY_REGISTERED_ERROR } from "../constants.js";
import { BadRequestException } from "../errors/BadRequestException.js"

export class UserController {
  constructor() {
    this.userService = new UserService();
  }
  async register(req, res) {
    const dto = req.body;
    try {
      const user = await this.userService.findUser(dto.email);
      if (user) {
        return new BadRequestException(res, ALREADY_REGISTERED_ERROR);
      }
      const newUser = await this.userService.registerUser(dto);
      return res.json({
          success: true,
          id: newUser._id,
          name: newUser.name,
          email: newUser.email,
          role: newUser.role,
      });
    } catch (err) {
      const statusCode = err.status || 401;
      return res.status(statusCode).json({
        success: false,
        message: err.message,
      });
    }
  }

  async login(req, res) {
    const { email: login, password } = req.body;
    try {
      const user = await this.userService.validateUser(res, login, password);
      return res.json(await this.userService.login(user));
    } catch (err) {
      const statusCode = err.status || 401;
      return res.status(statusCode).json({
        success: false,
        message: err.message,
      });
    }
  }
}