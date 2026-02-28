import { sendMail } from "../utils/mailer.js";

export default class EmailProvider {
  /**
   * Send an email
   * @param {Object} options
   * @param {string} options.to
   * @param {string} options.subject
   * @param {string} options.html
   * @returns {Promise<any>}
   */
  async send({ to, subject, html }) {
    return await sendMail({ to, subject, html });
  }
}
