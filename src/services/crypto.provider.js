import bcrypt from "bcryptjs";

export default class CryptoProvider {
  /**
   * Hash a password or string
   * @param {string} data
   * @param {number} saltRounds
   * @returns {Promise<string>}
   */
  async hash(data, saltRounds = 10) {
    return await bcrypt.hash(data, saltRounds);
  }

  /**
   * Compare a plain text string against a hash
   * @param {string} data
   * @param {string} hash
   * @returns {Promise<boolean>}
   */
  async compare(data, hash) {
    return await bcrypt.compare(data, hash);
  }
}
