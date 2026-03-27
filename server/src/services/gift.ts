import { User } from '../models/User.js';
import { Transaction } from '../models/Transaction.js';
import mongoose from 'mongoose';

export class GiftService {
  private coinValue = 0.01; // 100 coins = $1 USD
  private masterEmail = 'eliecerdepablos@gmail.com';

  // Economic Policies
  private readonly WITHDRAWAL_CAP_NEW = 1000000;
  private readonly WITHDRAWAL_CAP_VERIFIED = 1000000;
  private readonly WHALE_FEE_THRESHOLD = 5000; 
  private readonly STANDARD_WITHDRAWAL_FEE = 0.05; // 5% for standard users
  private readonly WHALE_WITHDRAWAL_FEE = 0.10; // 10% for Whales/Bots
  private readonly TRANSFER_TAX = 0.10; // 10% on all transfers/gifts
  // User can now withdraw 100% of rewards (minedCoins) and earnings (balance)
  private readonly REWARD_WITHDRAWAL_PERCENT = 1.0; 

  private formatCurrency(amount: number): string {
    return `$${amount.toFixed(2)}`;
  }

  /**
   * Send a gift from one user to another
   */
  async sendGift(senderId: string, receiverId: string, coinAmount: number) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const sender = await User.findById(senderId).session(session);
      const receiver = await User.findById(receiverId).session(session);

      if (!sender || !receiver) throw new Error('User not found');
      const totalCoins = sender.purchasedCoins + sender.minedCoins;
      if (totalCoins < coinAmount) throw new Error('Insufficient coins');

      // 1. Deduct Coins (Prioritize Purchased)
      let remainingToDeduct = coinAmount;
      if (sender.purchasedCoins >= remainingToDeduct) {
        sender.purchasedCoins -= remainingToDeduct;
        remainingToDeduct = 0;
      } else {
        remainingToDeduct -= sender.purchasedCoins;
        sender.purchasedCoins = 0;
        sender.minedCoins -= remainingToDeduct;
      }
      await sender.save();

      // 2. Calculate Revenue Split (Aggressive Ecosystem Protection)
      const grossValue = coinAmount * this.coinValue;
      
      // Platform tax for transfers/gifts (10% from sender, 10% from receiver as per user request)
      const senderTax = grossValue * this.TRANSFER_TAX;
      const receiverTax = grossValue * this.TRANSFER_TAX;
      const platformFee = senderTax + receiverTax; // Aggregated fee for logging
      const agencyFee = 0; // Agencies disabled as per current manual request, but keeping variable for consistency

      let netEarnings = grossValue - platformFee;

      // 3. Credit Receiver & Propagate Whale Status
      receiver.balance += netEarnings;

      if (sender.isWhaleOrBot && !receiver.isWhaleOrBot) {
        receiver.isWhaleOrBot = true;
        receiver.whaleOrBotSince = new Date();
      }

      await receiver.save();

      // 4. Credit Platform (Master Account)
      const masterAccount = await User.findOne({ email: this.masterEmail }).session(session);
      if (masterAccount) {
        masterAccount.balance += platformFee;
        await masterAccount.save();
      } else {
        console.warn(`⚠️ Master account (${this.masterEmail}) not found. Platform fee not credited.`);
      }

      // 5. Log Transaction
      const transaction = new Transaction({
        senderId: sender._id,
        receiverId: receiver._id,
        type: 'gift',
        amount: grossValue,
        coins: coinAmount,
        fee: platformFee,
        agencyFee: agencyFee,
        status: 'completed',
        metadata: {
          receiverIsAgencyMember: receiver.isAgencyMember,
          splitPercentage: receiver.isAgencyMember ? 70 : 60,
          platformAccountId: masterAccount?._id
        }
      });
      await transaction.save({ session });

      await session.commitTransaction();
      return { success: true, netEarnings, transactionId: transaction._id };

    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Request withdrawal
   */
  async requestWithdrawal(userId: string, amount: number, method: 'zinli' | 'crypto' | 'paypal' | 'airtm' | 'zelle' | 'bank' | 'binance' | 'reserve' | 'airbnb', details: any) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = await User.findById(userId).session(session);
      if (!user) throw new Error('User not found');
      
      // 1. Check Daily Withdrawal Cap and Whale Status
      if (amount >= this.WHALE_FEE_THRESHOLD && !user.isWhaleOrBot) {
        user.isWhaleOrBot = true;
        user.whaleOrBotSince = new Date();
      }

      const today = new Date().setHours(0, 0, 0, 0);
      const lastWithdrawal = user.lastWithdrawalDate ? new Date(user.lastWithdrawalDate).setHours(0, 0, 0, 0) : 0;
      
      if (lastWithdrawal < today) {
        user.dailyWithdrawalAmount = 0;
      }

      let currentCap = user.isVerified ? this.WITHDRAWAL_CAP_VERIFIED : this.WITHDRAWAL_CAP_NEW;

      if (user.isWhaleOrBot && user.whaleOrBotSince) {
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        const timeSinceFlagged = Date.now() - user.whaleOrBotSince.getTime();
        
        if (timeSinceFlagged < thirtyDaysMs) {
          // Restricted to $1000 / day during the first month
          currentCap = 1000;
        } else {
          // After a month, unlimited withdrawals!
          currentCap = Infinity;
        }
      }

      if (user.dailyWithdrawalAmount + amount > currentCap) {
        throw new Error(`Daily withdrawal cap exceeded. Your limit is $${currentCap === Infinity ? 'Ilimitado' : currentCap} USD/day.`);
      }

      // 2. Validate Withdrawable Balance
      // Total withdrawable = balance (Earnings from Gifts) + (minedCoins converted to USD)
      // Purchased coins can NEVER be withdrawn.
      const rewardsInUSD = user.minedCoins * this.coinValue;
      const totalWithdrawable = user.balance + rewardsInUSD;

      if (amount > totalWithdrawable) {
        throw new Error(`Saldo insuficiente. Puedes retirar ${this.formatCurrency(totalWithdrawable)}, pero las fichas compradas están bloqueadas para regalos.`);
      }

      // Pro-Grade Security: Lock high-value withdrawals behind verified KYC
      if (amount > 100 && user.kycData?.status !== 'verified') {
        throw new Error('Retiros mayores a $100 requieren verificación KYC aprobada.');
      }

      // 3. Calculate Fee: User (5%) vs Whale/Bot (10%)
      const feePercent = user.isWhaleOrBot ? this.WHALE_WITHDRAWAL_FEE : this.STANDARD_WITHDRAWAL_FEE;
      const totalFee = amount * feePercent;
      const standardFee = user.isWhaleOrBot ? 0 : totalFee; // Simplified for logging
      const whalePenalty = user.isWhaleOrBot ? totalFee : 0;
      const netAmount = amount - totalFee;

      // 4. Update User Balance & Limits
      // Deduct from balance first, then minedCoins
      let remainingToDeductUSD = amount;
      if (user.balance >= remainingToDeductUSD) {
        user.balance -= remainingToDeductUSD;
        remainingToDeductUSD = 0;
      } else {
        remainingToDeductUSD -= user.balance;
        user.balance = 0;
        // Convert remaining USD to coins and deduct from minedCoins
        const coinsToDeduct = remainingToDeductUSD / this.coinValue;
        user.minedCoins = Math.max(0, user.minedCoins - coinsToDeduct);
      }

      user.dailyWithdrawalAmount += amount;
      user.lastWithdrawalDate = new Date();
      await user.save();

      // 4.5 Credit Platform with the Withdrawal Fees
      const masterAccount = await User.findOne({ email: this.masterEmail }).session(session);
      if (masterAccount) {
        // Standard fee goes to platform principal (balance)
        masterAccount.balance = (masterAccount.balance || 0) + standardFee;
        
        if (whalePenalty > 0) {
          // 10% penalty fee goes to admin incentives (bmIncentivo)
          masterAccount.bmIncentivo = (masterAccount.bmIncentivo || 0) + whalePenalty;
        }
        await masterAccount.save();
      }

      // 5. Log Transaction
      const transaction = new Transaction({
        receiverId: user._id,
        type: 'withdrawal',
        amount: netAmount,
        fee: totalFee,
        status: 'pending',
        method,
        metadata: { 
          withdrawalDetails: details,
          standardFee,
          whalePenalty,
          isWhale: amount >= this.WHALE_FEE_THRESHOLD
        }
      });
      await transaction.save({ session });

      await session.commitTransaction();
      return transaction;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }
}

export const giftService = new GiftService();
