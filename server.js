const express = require('express');
const cors = require('cors');
const { verifyEmail, getDidYouMean } = require('./emailVerification');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Email Verification API',
    version: '1.0.0',
    endpoints: {
      'POST /api/verify': 'Verify an email address',
      'POST /api/did-you-mean': 'Get typo suggestion for an email',
      'GET /health': 'Health check'
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Verify email endpoint
app.post('/api/verify', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required',
        message: 'Please provide an email address in the request body'
      });
    }

    if (typeof email !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format',
        message: 'Email must be a string'
      });
    }

    const result = await verifyEmail(email);
    
    // Determine HTTP status code based on result
    let statusCode = 200;
    if (result.result === 'invalid' && result.resultcode === 6) {
      statusCode = 400;
    } else if (result.result === 'unknown') {
      statusCode = 202; // Accepted but uncertain
    }

    res.status(statusCode).json({
      success: result.result === 'valid',
      data: result
    });

  } catch (error) {
    console.error('Error verifying email:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Did You Mean endpoint
app.post('/api/did-you-mean', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required',
        message: 'Please provide an email address in the request body'
      });
    }

    if (typeof email !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format',
        message: 'Email must be a string'
      });
    }

    const suggestion = getDidYouMean(email);

    res.json({
      success: true,
      data: {
        original: email,
        suggestion: suggestion,
        hasSuggestion: suggestion !== null
      }
    });

  } catch (error) {
    console.error('Error getting suggestion:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not found',
    message: `Route ${req.method} ${req.path} not found`
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`Email Verification API server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`API endpoint: http://localhost:${PORT}/api/verify`);
});

// Handle port conflicts
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use.`);
    console.log(`💡 Try one of these solutions:`);
    console.log(`   1. Kill the process using port ${PORT}:`);
    console.log(`      Windows: netstat -ano | findstr :${PORT} then taskkill /PID <PID> /F`);
    console.log(`   2. Use a different port:`);
    console.log(`      PORT=3001 npm start`);
    process.exit(1);
  } else {
    console.error('❌ Server error:', error);
    process.exit(1);
  }
});

module.exports = app;
