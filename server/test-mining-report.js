// Run with: node test-mining-report.js
import fetch from 'node-fetch';

async function testReport() {
  const report = {
    relay_units: 10,
    store_units: 5,
    uptime_units: 100,
    call_units: 2,
    reputation_units: 1
  };

  try {
    const response = await fetch('http://localhost:3000/api/payments/mining-report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Assuming no auth for local testing if needed, but the route has authMiddleware
        // In real test, would need a token
      },
      body: JSON.stringify(report)
    });
    
    const data = await response.json();
    console.log('Response:', data);
  } catch (error) {
    console.error('Error:', error);
  }
}

testReport();
