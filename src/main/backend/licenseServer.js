require('dotenv').config();
const express = require('express');
const stripe = require('stripe');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { join } = require('path');
const { app } = require('electron');
const { existsSync, mkdirSync } = require('fs');

class LicenseServer {
  constructor() {
    this.db = null;
    this.expressApp = null;
    this.server = null;
    this.port = 3001; // Different port from main app
    this.stripeClient = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the license server
   */
  async initialize() {
    if (this.isInitialized) return;

    try {
      console.log('🔐 [LicenseServer] Initializing...');
      
      // Initialize database
      this.initializeDatabase();
      
      // Initialize Stripe (if keys are available)
      this.initializeStripe();
      
      // Set up Express app
      this.setupExpress();
      
      this.isInitialized = true;
      console.log('✅ [LicenseServer] Initialized successfully');
    } catch (error) {
      console.error('❌ [LicenseServer] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Get platform-specific database path for licenses
   */
  getDatabasePath() {
    const userDataPath = app.getPath('userData');
    const dbDir = join(userDataPath, 'license');
    
    // Ensure directory exists
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }
    
    return join(dbDir, 'licenses.db');
  }

  /**
   * Initialize SQLite database
   */
  initializeDatabase() {
    const dbPath = this.getDatabasePath();
    console.log('🗄️ [LicenseServer] Database path:', dbPath);
    
    this.db = new sqlite3.Database(dbPath);

    // Create tables
    this.db.serialize(() => {
      // Lifetime licenses table
      this.db.run(`CREATE TABLE IF NOT EXISTS lifetime_licenses (
        id TEXT PRIMARY KEY,
        license_key TEXT UNIQUE NOT NULL,
        customer_email TEXT NOT NULL,
        customer_name TEXT,
        granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'active'
      )`);

      // Subscription licenses table
      this.db.run(`CREATE TABLE IF NOT EXISTS subscription_licenses (
        id TEXT PRIMARY KEY,
        license_key TEXT UNIQUE NOT NULL,
        stripe_customer_id TEXT NOT NULL,
        stripe_subscription_id TEXT,
        stripe_session_id TEXT,
        plan_type TEXT NOT NULL,
        customer_email TEXT,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME
      )`);

      // License validation history
      this.db.run(`CREATE TABLE IF NOT EXISTS license_validations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        license_key TEXT NOT NULL,
        validation_result TEXT NOT NULL,
        validated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        device_fingerprint TEXT
      )`);

      // App license state (current license info)
      this.db.run(`CREATE TABLE IF NOT EXISTS app_license_state (
        id INTEGER PRIMARY KEY,
        license_key TEXT,
        license_type TEXT,
        status TEXT DEFAULT 'unlicensed',
        last_validated DATETIME,
        next_validation DATETIME,
        customer_name TEXT,
        expires_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      console.log('📋 [LicenseServer] License tables created');
    });
  }

  /**
   * Initialize Stripe client
   */
  initializeStripe() {
    // For now, we'll load Stripe keys from environment or config
    // You can set these via environment variables or a config file
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    
    if (stripeSecretKey) {
      this.stripeClient = stripe(stripeSecretKey);
      console.log('💳 [LicenseServer] Stripe initialized');
    } else {
      console.log('⚠️ [LicenseServer] No Stripe key found - payment features disabled');
    }
  }

  /**
   * Set up Express app for local API
   */
  setupExpress() {
    this.expressApp = express();
    this.expressApp.use(cors());
    this.expressApp.use(express.json());

    // Health check
    this.expressApp.get('/health', (req, res) => {
      res.json({ status: 'License Server Running', timestamp: new Date().toISOString() });
    });

    // Validate license endpoint
    this.expressApp.post('/validate-license', (req, res) => {
      this.validateLicense(req.body.license_key)
        .then(result => res.json(result))
        .catch(error => res.status(500).json({ valid: false, reason: 'server_error', error: error.message }));
    });

    // Get current license state
    this.expressApp.get('/license-state', (req, res) => {
      this.getCurrentLicenseState()
        .then(state => res.json(state))
        .catch(error => res.status(500).json({ error: error.message }));
    });
  }

  /**
   * Start the Express server
   */
  async startServer() {
    if (!this.expressApp) {
      throw new Error('Express app not initialized');
    }

    return new Promise((resolve, reject) => {
      this.server = this.expressApp.listen(this.port, (error) => {
        if (error) {
          reject(error);
        } else {
          console.log(`🚀 [LicenseServer] Running on port ${this.port}`);
          resolve();
        }
      });
    });
  }

  /**
   * Validate a license key
   */
  async validateLicense(licenseKey) {
    if (!licenseKey) {
      return { valid: false, reason: 'missing_key' };
    }

    return new Promise((resolve) => {
      // Check lifetime licenses first
      this.db.get(
        'SELECT * FROM lifetime_licenses WHERE license_key = ? AND status = ?',
        [licenseKey, 'active'],
        (err, lifetimeRow) => {
          if (err) {
            console.error('Database error:', err);
            return resolve({ valid: false, reason: 'database_error' });
          }
          
          if (lifetimeRow) {
            // Record validation
            this.recordValidation(licenseKey, 'valid_lifetime');
            
            // Update app license state
            this.updateLicenseState({
              license_key: licenseKey,
              license_type: 'lifetime',
              status: 'active',
              customer_name: lifetimeRow.customer_name,
              last_validated: new Date().toISOString(),
              next_validation: null // Lifetime never expires
            });

            return resolve({
              valid: true,
              license_type: 'lifetime',
              customer_name: lifetimeRow.customer_name,
              never_expires: true,
              granted_at: lifetimeRow.granted_at
            });
          }
          
          // Check subscription licenses
          this.db.get(
            'SELECT * FROM subscription_licenses WHERE license_key = ? AND status = ?',
            [licenseKey, 'active'],
            (err, subRow) => {
              if (err) {
                console.error('Database error:', err);
                return resolve({ valid: false, reason: 'database_error' });
              }
              
              if (!subRow) {
                this.recordValidation(licenseKey, 'invalid_key');
                return resolve({ valid: false, reason: 'invalid_key' });
              }
              
              // Check if subscription is expired
              const now = new Date();
              const expiresAt = new Date(subRow.expires_at);
              
              if (now > expiresAt) {
                this.recordValidation(licenseKey, 'expired');
                return resolve({ valid: false, reason: 'expired' });
              }
              
              // Calculate next validation date
              let nextValidation;
              if (subRow.plan_type === 'monthly') {
                nextValidation = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000)); // 30 days
              } else if (subRow.plan_type === 'annual') {
                nextValidation = new Date(now.getTime() + (365 * 24 * 60 * 60 * 1000)); // 365 days
              }

              // Record validation
              this.recordValidation(licenseKey, 'valid_subscription');
              
              // Update app license state
              this.updateLicenseState({
                license_key: licenseKey,
                license_type: 'subscription',
                status: 'active',
                last_validated: now.toISOString(),
                next_validation: nextValidation?.toISOString(),
                expires_at: subRow.expires_at
              });

              resolve({
                valid: true,
                license_type: 'subscription',
                plan_type: subRow.plan_type,
                expires_at: subRow.expires_at,
                next_validation: nextValidation?.toISOString()
              });
            }
          );
        }
      );
    });
  }

  /**
   * Record license validation attempt
   */
  recordValidation(licenseKey, result) {
    this.db.run(
      'INSERT INTO license_validations (license_key, validation_result) VALUES (?, ?)',
      [licenseKey, result],
      (err) => {
        if (err) {
          console.error('Failed to record validation:', err);
        }
      }
    );
  }

  /**
   * Update current app license state
   */
  updateLicenseState(state) {
    this.db.run(
      `INSERT OR REPLACE INTO app_license_state 
       (id, license_key, license_type, status, last_validated, next_validation, customer_name, expires_at) 
       VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
      [
        state.license_key,
        state.license_type,
        state.status,
        state.last_validated,
        state.next_validation,
        state.customer_name,
        state.expires_at
      ],
      (err) => {
        if (err) {
          console.error('Failed to update license state:', err);
        } else {
          console.log('✅ [LicenseServer] License state updated');
        }
      }
    );
  }

  /**
   * Get current license state
   */
  async getCurrentLicenseState() {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM app_license_state WHERE id = 1',
        (err, row) => {
          if (err) {
            reject(err);
          } else if (!row) {
            resolve({
              status: 'unlicensed',
              license_type: null,
              license_key: null,
              last_validated: null,
              next_validation: null
            });
          } else {
            resolve(row);
          }
        }
      );
    });
  }

  /**
   * Check if license needs revalidation
   */
  async needsRevalidation() {
    try {
      const state = await this.getCurrentLicenseState();
      
      if (state.status === 'unlicensed' || !state.license_key) {
        return true;
      }

      if (state.license_type === 'lifetime') {
        return false; // Lifetime never needs revalidation
      }

      if (state.next_validation) {
        const now = new Date();
        const nextValidation = new Date(state.next_validation);
        return now >= nextValidation;
      }

      return true;
    } catch (error) {
      console.error('Error checking revalidation:', error);
      return true; // Err on the side of caution
    }
  }

  /**
   * Get payment links (configured by user)
   */
  getPaymentLinks() {
    return {
      monthly: "https://buy.stripe.com/MONTHLY_LINK_HERE", // Replace with your monthly payment link
      annual: "https://buy.stripe.com/ANNUAL_LINK_HERE",   // Replace with your annual payment link
      lifetime: "https://buy.stripe.com/LIFETIME_LINK_HERE", // Replace with your lifetime payment link
      portal: "https://billing.stripe.com/p/login/PORTAL_LINK_HERE" // Replace with your customer portal link
    };
  }

  /**
   * Stop the server
   */
  async stopServer() {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          console.log('🛑 [LicenseServer] Server stopped');
          resolve();
        });
      });
    }
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close((err) => {
        if (err) {
          console.error('Error closing license database:', err);
        } else {
          console.log('🔒 [LicenseServer] Database connection closed');
        }
      });
    }
  }
}

module.exports = { LicenseServer }; 