import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'taktak.massenger@gmail.com',
    pass: process.env.EMAIL_PASS || 'Glenis/1976@1973'
  }
});

export const sendEmail = async (to: string, subject: string, text: string, html?: string) => {
  try {
    const info = await transporter.sendMail({
      from: `"TakTak Messenger" <${process.env.EMAIL_USER || 'taktak.massenger@gmail.com'}>`,
      to,
      subject,
      text,
      html
    });
    console.log('✅ Email sent: %s', info.messageId);
    return info;
  } catch (error) {
    console.error('❌ Error sending email:', error);
    throw error;
  }
};
