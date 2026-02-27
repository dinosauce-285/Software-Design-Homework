export class CaptchaService {
  /**
   * Verify Google reCAPTCHA token
   * @param {string} recaptchaResponse - Token from client
   * @returns {Promise<boolean>} True if verification succeeds
   */
  static async verify(recaptchaResponse) {
    if (!recaptchaResponse) {
      return false;
    }

    const secretKey = process.env.RECAPTCHA_SECRET;
    if (!secretKey) {
      console.warn(
        "RECAPTCHA_SECRET is not defined, skipping captcha bypass in dev",
      );
      return true; // Optionally bypass if not configured in dev
    }

    const verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${recaptchaResponse}`;

    try {
      const response = await fetch(verifyUrl, { method: "POST" });
      const data = await response.json();
      return !!data.success;
    } catch (err) {
      console.error("Recaptcha error:", err);
      return false;
    }
  }
}
