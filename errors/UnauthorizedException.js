export class UnauthorizedException extends Error {
    constructor(res, message) {
        super(message);
        this.name = "UnauthorizedException";
        this.status = 401;

        // this.sendResponse(res);
    }

    // sendResponse(res) {
    //     res.status(this.status).json({
    //         success: false,
    //         message: this.message,
    //     });
    // }
}