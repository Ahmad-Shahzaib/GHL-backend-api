import nodemailer from 'nodemailer';
import { config } from '../config';
import { logger } from '../utils/logger';

class EmailService {
  private transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    auth: {
      user: config.SMTP_USER,
      pass: config.SMTP_PASS,
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  async sendWelcome(email: string, passwordSetToken: string): Promise<void> {
    const link = `${config.FRONTEND_URL}/set-password?token=${passwordSetToken}`;
    await this.transporter.sendMail({
      from: config.EMAIL_FROM,
      to: email,
      subject: 'Welcome to Clinic Engine — Set Your Password',
      html: `
        <h2>Welcome to Clinic Engine!</h2>
        <p>Your clinic dashboard is ready. Click the button below to set your password and access your account.</p>
        <a href="${link}" style="background:#c9a96e;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;">Set My Password</a>
        <p>This link expires in 24 hours.</p>
      `,
    });
    logger.info(`Welcome email sent to ${email}`);
  }

  async sendPasswordReset(email: string, token: string): Promise<void> {
    const link = `${config.FRONTEND_URL}/reset-password?token=${token}`;
    await this.transporter.sendMail({
      from: config.EMAIL_FROM,
      to: email,
      subject: 'Clinic Engine — Password Reset',
      html: `
        <h2>Reset Your Password</h2>
        <p>Click the button below to reset your password.</p>
        <a href="${link}" style="background:#c9a96e;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;">Reset Password</a>
        <p>This link expires in 1 hour. If you did not request this, ignore this email.</p>
      `,
    });
    logger.info(`Password reset email sent to ${email}`);
  }
}

export const emailService = new EmailService();
