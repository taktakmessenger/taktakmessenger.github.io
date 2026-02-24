import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

const client = accountSid && authToken ? twilio(accountSid, authToken) : null;

export const sendSMS = async (to: string, body: string) => {
  if (!client || !twilioPhoneNumber) {
    console.log('📱 Twilio no configurado. SMS simulado:', { to, body });
    return { sid: 'SIMULATED', status: 'simulated' };
  }

  try {
    const message = await client.messages.create({
      body,
      from: twilioPhoneNumber,
      to
    });
    
    console.log('✅ SMS enviado:', message.sid);
    return message;
  } catch (error) {
    console.error('❌ Error enviando SMS:', error);
    throw error;
  }
};

export const sendVerificationSMS = async (phone: string, otp: string) => {
  const message = `🔐 Tu código de verificación TakTak es: ${otp}\n\nEste código expira en 10 minutos.`;
  return sendSMS(phone, message);
};

export default { sendSMS, sendVerificationSMS };
