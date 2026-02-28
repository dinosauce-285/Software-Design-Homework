export default class Container {
  constructor() {
    this.services = new Map();
  }

  /**
   * Register a dependency instance or constant by name
   * @param {string} name
   * @param {any} dependency
   */
  register(name, dependency) {
    this.services.set(name, dependency);
  }

  /**
   * Resolve a dependency by name
   * @param {string} name
   * @returns {any}
   */
  resolve(name) {
    if (!this.services.has(name)) {
      throw new Error(`Dependency '${name}' not found in container.`);
    }
    return this.services.get(name);
  }
}
