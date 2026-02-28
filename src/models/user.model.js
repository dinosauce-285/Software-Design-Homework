export class UserModel {
  constructor(db) {
    this.db = db;
  }

  async add(user) {
    const rows = await this.db("users")
      .insert(user)
      .returning([
        "id",
        "email",
        "fullname",
        "address",
        "role",
        "email_verified",
      ]);
    return rows[0];
  }

  findById(id) {
    return this.db("users").where("id", id).first();
  }

  loadAllUsers() {
    return this.db("users").orderBy("id", "desc");
  }

  findUsersByRole(role) {
    return this.db("users")
      .select("users.id", "users.fullname", "users.email", "users.role")
      .where("users.role", role)
      .orderBy("users.fullname", "asc");
  }

  findByUserName(username) {
    return this.db("users").where("username", username).first();
  }

  async update(id, user) {
    const rows = await this.db("users")
      .where("id", id)
      .update(user)
      .returning("*");

    return rows[0];
  }

  findByEmail(email) {
    return this.db("users").where("email", email).first();
  }

  // ===================== OTP USING KNEX =====================

  createOtp({ user_id, otp_code, purpose, expires_at }) {
    return this.db("user_otps").insert({
      user_id,
      otp_code,
      purpose,
      expires_at,
    });
  }

  findValidOtp({ user_id, otp_code, purpose }) {
    return this.db("user_otps")
      .where({
        user_id,
        otp_code,
        purpose,
        used: false,
      })
      .andWhere("expires_at", ">", this.db.fn.now())
      .orderBy("id", "desc")
      .first();
  }

  markOtpUsed(id) {
    return this.db("user_otps").where("id", id).update({ used: true });
  }

  verifyUserEmail(user_id) {
    return this.db("users")
      .where("id", user_id)
      .update({ email_verified: true });
  }

  updateUserInfo(user_id, { email, fullname, address }) {
    return this.db("users")
      .where("id", user_id)
      .update({ email, fullname, address });
  }

  markUpgradePending(user_id) {
    return this.db("users")
      .where("id", user_id)
      .update({ is_upgrade_pending: true });
  }

  updateUserRoleToSeller(user_id) {
    return this.db("users")
      .where("id", user_id)
      .update({ role: "seller", is_upgrade_pending: false });
  }

  // ===================== OAUTH SUPPORT =====================

  findByOAuthProvider(provider, oauth_id) {
    return this.db("users")
      .where({
        oauth_provider: provider,
        oauth_id: oauth_id,
      })
      .first();
  }

  addOAuthProvider(user_id, provider, oauth_id) {
    return this.db("users").where("id", user_id).update({
      oauth_provider: provider,
      oauth_id: oauth_id,
      email_verified: true,
    });
  }

  async deleteUser(id) {
    return this.db("users").where("id", id).del();
  }
}

import db from "../utils/db.js";
const defaultUserModel = new UserModel(db);

export { defaultUserModel as default };

export const add = defaultUserModel.add.bind(defaultUserModel);
export const findById = defaultUserModel.findById.bind(defaultUserModel);
export const loadAllUsers =
  defaultUserModel.loadAllUsers.bind(defaultUserModel);
export const findUsersByRole =
  defaultUserModel.findUsersByRole.bind(defaultUserModel);
export const findByUserName =
  defaultUserModel.findByUserName.bind(defaultUserModel);
export const update = defaultUserModel.update.bind(defaultUserModel);
export const findByEmail = defaultUserModel.findByEmail.bind(defaultUserModel);
export const createOtp = defaultUserModel.createOtp.bind(defaultUserModel);
export const findValidOtp =
  defaultUserModel.findValidOtp.bind(defaultUserModel);
export const markOtpUsed = defaultUserModel.markOtpUsed.bind(defaultUserModel);
export const verifyUserEmail =
  defaultUserModel.verifyUserEmail.bind(defaultUserModel);
export const updateUserInfo =
  defaultUserModel.updateUserInfo.bind(defaultUserModel);
export const markUpgradePending =
  defaultUserModel.markUpgradePending.bind(defaultUserModel);
export const updateUserRoleToSeller =
  defaultUserModel.updateUserRoleToSeller.bind(defaultUserModel);
export const findByOAuthProvider =
  defaultUserModel.findByOAuthProvider.bind(defaultUserModel);
export const addOAuthProvider =
  defaultUserModel.addOAuthProvider.bind(defaultUserModel);
export const deleteUser = defaultUserModel.deleteUser.bind(defaultUserModel);
