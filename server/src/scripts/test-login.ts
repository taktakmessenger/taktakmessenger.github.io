import axios from 'axios';

const testLogin = async () => {
  const identifier = 'eliecerdepablos@gmail.com'; // Known admin email
  const password = '123456'; // Default password from seed or previous tasks if any
  
  try {
    console.log(`Testing login for ${identifier}...`);
    const response = await axios.post('http://localhost:5000/api/auth/login-password', {
      identifier,
      password
    });
    
    console.log('Login successful!');
    console.log('Token:', response.data.token ? 'Received' : 'Not received');
    console.log('User:', response.data.user.username);
  } catch (error: any) {
    console.error('Login failed:', error.response?.data || error.message);
  }
};

testLogin();
