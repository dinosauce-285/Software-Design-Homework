import bcrypt from "bcryptjs";

/**
 * Base Strategy interface for Identity Management
 * Adheres to the Open/Closed Principle (OCP)
 */
export class IdentityProvider {
  /**
   * Validate if the user is allowed to update their profile with the given payload
   * @param {Object} user
   * @param {Object} payload
   * @throws {Error} If validation fails
   */
  validateProfileUpdate(user, payload) {
    throw new Error("Method not implemented.");
  }

  /**
   * Produce the final entity required to update the database
   * @param {Object} user
   * @param {Object} payload
   * @returns {Object}
   */
  prepareUpdateEntity(user, payload) {
    throw new Error("Method not implemented.");
  }
}

/**
 * Strategy for standard Local Accounts created via traditional Signup
 */
export class LocalIdentityProvider extends IdentityProvider {
  validateProfileUpdate(user, payload) {
    const { old_password, new_password, confirm_new_password } = payload;

    if (
      !old_password ||
      !bcrypt.compareSync(old_password, user.password_hash)
    ) {
      throw new Error("Password is incorrect!");
    }

    if (new_password && new_password !== confirm_new_password) {
      throw new Error("New passwords do not match.");
    }
    return true;
  }

  prepareUpdateEntity(user, payload) {
    const { email, fullname, address, date_of_birth, new_password } = payload;

    const entity = {
      email,
      fullname,
      address: address || user.address,
      date_of_birth: date_of_birth
        ? new Date(date_of_birth)
        : user.date_of_birth,
    };

    entity.password_hash = new_password
      ? bcrypt.hashSync(new_password, 10)
      : user.password_hash;

    return entity;
  }
}

/**
 * Strategy for OAuth Accounts (Google, Facebook, Apple etc.)
 */
export class OAuthIdentityProvider extends IdentityProvider {
  validateProfileUpdate(user, payload) {
    // OAuth users bypass password validation
    return true;
  }

  prepareUpdateEntity(user, payload) {
    const { email, fullname, address, date_of_birth } = payload;

    return {
      email,
      fullname,
      address: address || user.address,
      date_of_birth: date_of_birth
        ? new Date(date_of_birth)
        : user.date_of_birth,
      // OAuth accounts do not manage passwords here
    };
  }
}

/**
 * Factory class to encapsulate Identity Provider selection
 */
export class IdentityProviderFactory {
  /**
   * @param {Object} user
   * @returns {IdentityProvider}
   */
  static getProvider(user) {
    if (user.oauth_provider) {
      return new OAuthIdentityProvider();
    }
    return new LocalIdentityProvider();
  }
}
