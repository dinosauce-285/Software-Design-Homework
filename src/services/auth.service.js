import bcrypt from "bcryptjs";
import * as userModel from "../models/user.model.js";

export class AuthService {
  /**
   * Register a new user in the system
   * @param {Object} userData
   * @returns {Promise<{user: Object, otp: string}>}
   */
  static async registerUser({ email, fullname, address, password }) {
    // 1. Check if email exists
    const isEmailExist = await userModel.findByEmail(email);
    if (isEmailExist) {
      throw new Error("Email is already in use");
    }

    // 2. Hash password
    const hashedPassword = bcrypt.hashSync(password, 10);

    // 3. Save User to Database
    const user = {
      email,
      fullname,
      address,
      password_hash: hashedPassword,
      role: "bidder",
    };

    const newUser = await userModel.add(user);

    // 4. Generate random OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 phút

    // 5. Store OTP
    await userModel.createOtp({
      user_id: newUser.id,
      otp_code: otp,
      purpose: "verify_email",
      expires_at: expiresAt,
    });

    return { user: newUser, otp };
  }
}
