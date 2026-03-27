import mongoose from 'mongoose';
import { miningService } from './mining.js';

class SecurityService {
  private lastActionTimes: Map<string, number> = new Map();
  private hourlyActionCounts: Map<string, { count: number, hour: number }> = new Map();
  
  private readonly MIN_ACTION_INTERVAL = 1000; // 1 second between rewarded actions
  private readonly MAX_ACTIONS_PER_HOUR = 100; // Anti-Bot: Max 100 interaction rewards per hour

  /**
   * Check if an action is suspicious (too fast or too many)
   */
  isBotActivity(userId: string): boolean {
    const now = Date.now();
    const currentHour = Math.floor(now / 3600000);
    
    // 1. Rate Limiting
    const lastAction = this.lastActionTimes.get(userId) || 0;
    if (now - lastAction < this.MIN_ACTION_INTERVAL) {
      console.warn(`🛡️ Bot detected: User ${userId} acting too fast.`);
      return true;
    }

    // 2. Hourly Cap
    const hourlyData = this.hourlyActionCounts.get(userId) || { count: 0, hour: currentHour };
    if (hourlyData.hour !== currentHour) {
      hourlyData.count = 0;
      hourlyData.hour = currentHour;
    }

    if (hourlyData.count >= this.MAX_ACTIONS_PER_HOUR) {
      console.warn(`🛡️ Bot detected: User ${userId} exceeded hourly limit.`);
      return true;
    }

    hourlyData.count++;
    this.hourlyActionCounts.set(userId, hourlyData);
    this.lastActionTimes.set(userId, now);
    return false;
  }

  /**
   * Wipe or penalize a suspected bot (Future expansion)
   */
  async penalizeBot(userId: string) {
    import('../models/User.js').then(async ({ User }) => {
      await User.findByIdAndUpdate(userId, { isWhaleOrBot: true, whaleOrBotSince: new Date() });
      console.warn(`🛡️ User ${userId} has been flagged as a bot persistently.`);
    }).catch(console.error);
  }

  /**
   * Closes an account and sweeps any remaining balance to the admin's 10% pool (bmIncentivo).
   */
  async closeAccount(userId: string, reason: string = 'User closed account') {
    const { User } = await import('../models/User.js');
    const { Transaction } = await import('../models/Transaction.js');
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = await User.findById(userId).session(session);
      if (!user) throw new Error('User not found');

      const COIN_VALUE = 0.01;
      const rewardsInUSD = user.minedCoins * COIN_VALUE;
      const totalBalanceToSweep = user.balance + rewardsInUSD;

      if (totalBalanceToSweep > 0) {
        const masterAccount = await User.findOne({ email: 'elmalayaso7@gmail.com' }).session(session);
        if (masterAccount) {
          masterAccount.bmIncentivo = (masterAccount.bmIncentivo || 0) + totalBalanceToSweep;
          await masterAccount.save({ session });

          const tx = new Transaction({
            senderId: user._id,
            receiverId: masterAccount._id,
            type: 'system_sweep',
            amount: totalBalanceToSweep,
            fee: 0,
            status: 'completed',
            metadata: { info: `Sweep from closed account: ${reason}` }
          });
          await tx.save({ session });
        }
      }

      user.balance = 0;
      user.minedCoins = 0;
      user.purchasedCoins = 0;
      user.isBanned = true;
      user.bannedUntil = new Date(2100, 0, 1); // Permanent closure
      await user.save({ session });

      await session.commitTransaction();
      console.log(`🧹 Swept $${totalBalanceToSweep} from closed user ${userId}`);
    } catch (error) {
      await session.abortTransaction();
      console.error('❌ Failed to close account:', error);
    } finally {
      session.endSession();
    }
  }

  /**
   * Sweeps accounts that have been inactive or permanently banned for over 180 days.
   */
  async sweepInactiveAccounts() {
    const { User } = await import('../models/User.js');
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setDate(sixMonthsAgo.getDate() - 180);

    const inactiveUsers = await User.find({
      $and: [
        { updatedAt: { $lt: sixMonthsAgo } },
        {
          $or: [
            { balance: { $gt: 0 } },
            { minedCoins: { $gt: 0 } }
          ]
        }
      ]
    });

    for (const user of inactiveUsers) {
      await this.closeAccount(user._id.toString(), 'Inactivity / Banned Sweep');
    }
    console.log(`🧹 Swept ${inactiveUsers.length} inactive accounts.`);
  }
}

export const securityService = new SecurityService();
