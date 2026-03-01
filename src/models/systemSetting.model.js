import db from '../utils/db.js';

export function getSettings() {
    return db('system_settings').first();
}