// src/config.js
// Use environment variable for production, fallback to local network for development
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://192.168.100.63:8000';

export const API_BASE = 'https://hospital-api-30m6.onrender.com';