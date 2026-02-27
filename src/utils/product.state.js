/**
 * Define valid product states
 */
export const ObjectStatus = {
  ACTIVE: "ACTIVE",
  SOLD: "SOLD",
  PENDING: "PENDING",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED",
};

/**
 * Handles product state transitions safely
 */
export class ProductState {
  /**
   * Determine if a state transition is valid
   * @param {string} currentState
   * @param {string} targetState
   * @returns {boolean}
   */
  static isValidTransition(currentState, targetState) {
    // ACTIVE can go to any ending state
    if (currentState === ObjectStatus.ACTIVE) {
      return [
        ObjectStatus.SOLD,
        ObjectStatus.PENDING,
        ObjectStatus.EXPIRED,
        ObjectStatus.CANCELLED,
      ].includes(targetState);
    }

    // PENDING can go to SOLD or CANCELLED
    if (currentState === ObjectStatus.PENDING) {
      return [ObjectStatus.SOLD, ObjectStatus.CANCELLED].includes(targetState);
    }

    // Terminated states cannot transition back
    if (
      [
        ObjectStatus.SOLD,
        ObjectStatus.EXPIRED,
        ObjectStatus.CANCELLED,
      ].includes(currentState)
    ) {
      return false;
    }

    return false;
  }

  /**
   * Determine whether a status is terminal
   */
  static isTerminal(status) {
    return [
      ObjectStatus.SOLD,
      ObjectStatus.EXPIRED,
      ObjectStatus.CANCELLED,
    ].includes(status);
  }
}
