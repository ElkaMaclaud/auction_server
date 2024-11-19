export class BadRequestException extends Error {
    constructor(res, message) {
        super(message);
        this.name = "BadRequestException";
        this.status = 400; 
        
        this.sendResponse(res)
    }
    sendResponse(res) {
        res.status(this.status).json({
            success: false,
            message: this.message,
        });
    }
}