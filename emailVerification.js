const dns = require('dns').promises;
const net = require('net');

// Common email domain typos mapping
const COMMON_TYPOS = {
  'gmial.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmail.cm': 'gmail.com',
  'yahooo.com': 'yahoo.com',
  'yahoo.co': 'yahoo.com',
  'hotmial.com': 'hotmail.com',
  'hotmail.co': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'outlook.co': 'outlook.com',
  'gmai.com': 'gmail.com',
  'yaho.com': 'yahoo.com'
};

// Levenshtein distance calculation
function levenshteinDistance(str1, str2) {
  const m = str1.length;
  const n = str2.length;
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + 1
        );
      }
    }
  }

  return dp[m][n];
}

// Email syntax validation
function validateEmailSyntax(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email is empty or not a string' };
  }

  email = email.trim();

  if (email.length === 0) {
    return { valid: false, error: 'Email is empty' };
  }

  if (email.length > 254) {
    return { valid: false, error: 'Email is too long (max 254 characters)' };
  }

  // Check for multiple @ symbols
  const atCount = (email.match(/@/g) || []).length;
  if (atCount !== 1) {
    return { valid: false, error: 'Email must contain exactly one @ symbol' };
  }

  // Check for consecutive dots
  if (email.includes('..')) {
    return { valid: false, error: 'Email cannot contain consecutive dots' };
  }

  // Basic regex pattern
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { valid: false, error: 'Invalid email format' };
  }

  // More strict validation
  const parts = email.split('@');
  const localPart = parts[0];
  const domain = parts[1];

  if (localPart.length === 0 || localPart.length > 64) {
    return { valid: false, error: 'Local part is invalid' };
  }

  if (domain.length === 0 || domain.length > 253) {
    return { valid: false, error: 'Domain is invalid' };
  }

  // Check domain has at least one dot
  if (!domain.includes('.')) {
    return { valid: false, error: 'Domain must contain at least one dot' };
  }

  return { valid: true, email, localPart, domain };
}

// Get "Did You Mean?" suggestion
function getDidYouMean(email) {
  if (!email || typeof email !== 'string') {
    return null;
  }

  const parts = email.split('@');
  if (parts.length !== 2) {
    return null;
  }

  const localPart = parts[0];
  const domain = parts[1].toLowerCase();

  // Check common typos first
  if (COMMON_TYPOS[domain]) {
    return `${localPart}@${COMMON_TYPOS[domain]}`;
  }

  // Use Levenshtein distance for fuzzy matching
  const popularDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com'];
  let bestMatch = null;
  let minDistance = Infinity;

  for (const popularDomain of popularDomains) {
    const distance = levenshteinDistance(domain, popularDomain);
    // Only suggest if there's an actual difference (distance > 0) and it's within threshold
    if (distance > 0 && distance <= 2 && distance < minDistance) {
      minDistance = distance;
      bestMatch = popularDomain;
    }
  }

  if (bestMatch) {
    return `${localPart}@${bestMatch}`;
  }

  return null;
}

// DNS MX lookup
async function lookupMX(domain) {
  try {
    const mxRecords = await dns.resolveMx(domain);
    if (!mxRecords || mxRecords.length === 0) {
      return { success: false, error: 'No MX records found' };
    }
    
    // Sort by priority
    mxRecords.sort((a, b) => a.priority - b.priority);
    const mxHosts = mxRecords.map(record => record.exchange);
    
    return { success: true, mxHosts, mxRecords };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// SMTP connection and mailbox check
async function checkMailboxSMTP(email, mxHost, timeout = 10000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let socket = null;
    let responseBuffer = '';

    const cleanup = () => {
      if (socket) {
        socket.removeAllListeners();
        socket.destroy();
      }
    };

    const timeoutId = setTimeout(() => {
      cleanup();
      resolve({
        success: false,
        error: 'Connection timeout',
        subresult: 'connection_timeout'
      });
    }, timeout);

    try {
      socket = net.createConnection(25, mxHost);

      socket.on('connect', () => {
        // Wait for greeting
      });

      socket.on('data', (data) => {
        responseBuffer += data.toString();
        const lines = responseBuffer.split('\r\n');
        responseBuffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            const code = parseInt(line.substring(0, 3));

            // Greeting received
            if (code === 220) {
              socket.write('HELO verify.example.com\r\n');
            }
            // HELO response
            else if (code === 250 && line.includes('HELO')) {
              socket.write(`MAIL FROM:<verify@example.com>\r\n`);
            }
            // MAIL FROM response
            else if (code === 250 && line.includes('MAIL FROM')) {
              socket.write(`RCPT TO:<${email}>\r\n`);
            }
            // RCPT TO response - this is what we care about
            else if (line.includes('RCPT TO')) {
              clearTimeout(timeoutId);
              cleanup();

              if (code === 250) {
                resolve({
                  success: true,
                  subresult: 'mailbox_exists',
                  code: code
                });
              } else if (code === 550) {
                resolve({
                  success: false,
                  subresult: 'mailbox_does_not_exist',
                  code: code,
                  error: 'Mailbox does not exist'
                });
              } else if (code === 450 || code === 451) {
                resolve({
                  success: false,
                  subresult: 'greylisted',
                  code: code,
                  error: 'Temporary failure (greylisted)'
                });
              } else if (code === 452) {
                resolve({
                  success: false,
                  subresult: 'mailbox_full',
                  code: code,
                  error: 'Mailbox full'
                });
              } else if (code === 553) {
                resolve({
                  success: false,
                  subresult: 'mailbox_does_not_exist',
                  code: code,
                  error: 'Mailbox does not exist'
                });
              } else {
                resolve({
                  success: false,
                  subresult: 'unknown_error',
                  code: code,
                  error: `SMTP error: ${code}`
                });
              }
            }
          }
        }
      });

      socket.on('error', (error) => {
        clearTimeout(timeoutId);
        cleanup();
        resolve({
          success: false,
          error: error.message,
          subresult: 'connection_error'
        });
      });

      socket.on('close', () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      });

    } catch (error) {
      clearTimeout(timeoutId);
      cleanup();
      resolve({
        success: false,
        error: error.message,
        subresult: 'connection_error'
      });
    }
  });
}

// Main email verification function
async function verifyEmail(email) {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  // Default result structure
  const result = {
    email: email || '',
    result: 'invalid',
    resultcode: 6,
    subresult: 'syntax_error',
    domain: null,
    mxRecords: [],
    executiontime: 0,
    error: null,
    timestamp: timestamp,
    didyoumean: null
  };

  try {
    // Step 1: Syntax validation
    const syntaxCheck = validateEmailSyntax(email);
    if (!syntaxCheck.valid) {
      result.error = syntaxCheck.error;
      result.subresult = 'syntax_error';
      result.resultcode = 6;
      result.result = 'invalid';
      
      // Check for typo suggestions
      const suggestion = getDidYouMean(email);
      if (suggestion) {
        result.didyoumean = suggestion;
        result.subresult = 'typo_detected';
      }
      
      result.executiontime = ((Date.now() - startTime) / 1000).toFixed(2);
      return result;
    }

    result.email = syntaxCheck.email;
    result.domain = syntaxCheck.domain;

    // Check for typo suggestions even if syntax is valid
    const suggestion = getDidYouMean(syntaxCheck.email);
    if (suggestion) {
      result.didyoumean = suggestion;
    }

    // Step 2: DNS MX lookup
    const mxLookup = await lookupMX(syntaxCheck.domain);
    if (!mxLookup.success) {
      result.error = mxLookup.error;
      result.subresult = 'no_mx_records';
      result.resultcode = 6;
      result.result = 'invalid';
      // If we have a typo suggestion and no MX records, mark as typo_detected
      if (suggestion) {
        result.subresult = 'typo_detected';
      }
      result.executiontime = ((Date.now() - startTime) / 1000).toFixed(2);
      return result;
    }

    result.mxRecords = mxLookup.mxHosts;

    // Step 3: SMTP connection and mailbox check
    let smtpResult = null;
    let lastError = null;

    // Try each MX record in order
    for (const mxHost of mxLookup.mxHosts) {
      try {
        smtpResult = await checkMailboxSMTP(syntaxCheck.email, mxHost);
        
        if (smtpResult.success) {
          result.result = 'valid';
          result.resultcode = 1;
          result.subresult = smtpResult.subresult;
          result.executiontime = ((Date.now() - startTime) / 1000).toFixed(2);
          return result;
        } else {
          // If it's a definitive "does not exist" error, stop trying
          if (smtpResult.subresult === 'mailbox_does_not_exist') {
            result.result = 'invalid';
            result.resultcode = 6;
            result.subresult = smtpResult.subresult;
            result.error = smtpResult.error;
            result.executiontime = ((Date.now() - startTime) / 1000).toFixed(2);
            return result;
          }
          
          // For other errors (greylisted, timeout, etc.), try next MX
          lastError = smtpResult;
        }
      } catch (error) {
        lastError = {
          success: false,
          error: error.message,
          subresult: 'connection_error'
        };
      }
    }

    // If we get here, all MX records failed but not with "does not exist"
    if (lastError) {
      if (lastError.subresult === 'greylisted' || lastError.subresult === 'connection_timeout') {
        result.result = 'unknown';
        result.resultcode = 3;
      } else {
        result.result = 'invalid';
        result.resultcode = 6;
      }
      result.subresult = lastError.subresult;
      result.error = lastError.error;
    } else {
      result.result = 'unknown';
      result.resultcode = 3;
      result.subresult = 'connection_error';
      result.error = 'Could not connect to any mail server';
    }

  } catch (error) {
    result.error = error.message;
    result.subresult = 'unexpected_error';
    result.resultcode = 6;
    result.result = 'invalid';
  }

  result.executiontime = ((Date.now() - startTime) / 1000).toFixed(2);
  return result;
}

module.exports = {
  verifyEmail,
  getDidYouMean,
  validateEmailSyntax,
  levenshteinDistance
};
