import { User } from '../models/User.js';
import { Transaction } from '../models/Transaction.js';
import { SystemConfig } from '../models/SystemConfig.js';
import { securityService } from './security.js';
import mongoose from 'mongoose';

export class MiningService {
  private readonly MAX_SUPPLY = 50000000;
  private readonly GENESIS_SUPPLY = 50000000;
  private readonly MASTER_EMAIL = 'eliecerdepablos@gmail.com';
  private readonly REWARD_PER_MB = 0.1; // Initial reward: 0.1 Coin per MB served
  
  // Engagement Reward Constants
  private readonly REWARD_LIKE = 0.01;
  private readonly REWARD_COMMENT = 0.02;
  private readonly REWARD_CHECKIN = 1.0;
  private readonly REWARD_RECEIVE_LIKE = 0.05;
  private readonly REWARD_VIEW = 0.01; // Reward per threshold hit
  private readonly VIEW_REWARD_THRESHOLD = 10; // Every 10 videos watched

  private readonly DAILY_MINING_CAP = 500; // Cap of 500 coins per day
  
  // Mining Split Constants (New TakTak Architecture)
  private readonly PERCENT_CREATORS = 0.36;
  private readonly PERCENT_VIEWERS = 0.18;
  private readonly PERCENT_NODES = 0.36;
  private readonly PERCENT_ADMIN_INCENTIVE = 0.10;

  // Point System
  private readonly POINTS_PER_10S_VIEW = 1;
  private readonly POINTS_VIEW_80_PERCENT = 10;
  private readonly POINTS_LIKE = 2;
  private readonly POINTS_COMMENT = 5;
  private readonly POINTS_SHARE = 10;
  private readonly POINTS_LIVE_PER_SEC = 1;

  /**
   * Initialize Genesis Supply
   */
  async initializeGenesis() {
    const config = await SystemConfig.findOne({ key: 'genesis_minted' });
    if (config && config.value === true) {
      console.log('✅ Genesis supply already minted.');
      return;
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const masterUser = await User.findOne({ email: this.MASTER_EMAIL }).session(session);
      if (!masterUser) {
        console.warn(`⚠️ Master account (${this.MASTER_EMAIL}) not found. Cannot mint genesis.`);
        await session.abortTransaction();
        return;
      }

      // Mint 1B coins as mined coins for the master account
      masterUser.minedCoins += this.GENESIS_SUPPLY;
      await masterUser.save();

      // Track total supply
      await SystemConfig.findOneAndUpdate(
        { key: 'total_supply' },
        { value: this.GENESIS_SUPPLY },
        { upsert: true, session }
      );

      // Mark genesis as minted
      await SystemConfig.findOneAndUpdate(
        { key: 'genesis_minted' },
        { value: true },
        { upsert: true, session }
      );

      // Log transaction
      const transaction = new Transaction({
        receiverId: masterUser._id,
        type: 'mining',
        amount: 0,
        coins: this.GENESIS_SUPPLY,
        status: 'completed',
        metadata: { info: 'Genesis Supply Minting' }
      });
      await transaction.save({ session });

      await session.commitTransaction();
      console.log(`🚀 Genesis supply of ${this.GENESIS_SUPPLY} coins minted to ${this.MASTER_EMAIL}`);
    } catch (error) {
      await session.abortTransaction();
      console.error('❌ Failed to mint genesis supply:', error);
    } finally {
      session.endSession();
    }
  }

  /**
   * Proof-of-Retransmission (PoR) Reward
   * Rewards a user for serving data to peers.
   */
  async rewardSeeding(userId: string, megabytesServed: number) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const supplyConfig = await SystemConfig.findOne({ key: 'total_supply' }).session(session);
      const totalSupply = supplyConfig ? supplyConfig.value : 0;

      if (totalSupply >= this.MAX_SUPPLY) {
        console.log('🛑 Max supply reached. No more mining rewards.');
        await session.abortTransaction();
        return;
      }

      // Bot Detection
      if (securityService.isBotActivity(userId)) {
        await session.abortTransaction();
        return;
      }

      // Check Daily Cap
      const user = await User.findById(userId).session(session);
      if (!user) throw new Error('User not found');

      const today = new Date().setHours(0, 0, 0, 0);
      const lastMining = user.lastMiningDate ? new Date(user.lastMiningDate).setHours(0, 0, 0, 0) : 0;
      
      if (lastMining < today) {
        user.dailyMiningAmount = 0;
      }

      if (user.dailyMiningAmount >= this.DAILY_MINING_CAP) {
        console.log(`🚫 Daily mining cap reached for user ${userId}`);
        await session.abortTransaction();
        return;
      }

      // Calculate reward based on halving
      const halvingCount = Math.floor(totalSupply / 1000000000);
      const currentRewardPerMB = this.REWARD_PER_MB / Math.pow(2, halvingCount);
      
      let coinsToReward = Math.floor(megabytesServed * currentRewardPerMB);
      
      // Enforce Daily Cap
      coinsToReward = Math.min(coinsToReward, this.DAILY_MINING_CAP - user.dailyMiningAmount);
      
      if (coinsToReward <= 0) {
        await session.abortTransaction();
        return;
      }

      // Enforce Global Cap
      const finalReward = Math.min(coinsToReward, this.MAX_SUPPLY - totalSupply);

      // Credit User & Update Limits
      user.minedCoins += finalReward;
      user.dailyMiningAmount += finalReward;
      user.lastMiningDate = new Date();
      await user.save();

      // Update Total Supply
      await SystemConfig.findOneAndUpdate(
        { key: 'total_supply' },
        { $inc: { value: finalReward } },
        { session }
      );

      // Log Transaction
      const transaction = new Transaction({
        receiverId: new mongoose.Types.ObjectId(userId),
        type: 'mining',
        amount: 0,
        coins: finalReward,
        status: 'completed',
        metadata: { megabytesServed, rewardPerMB: currentRewardPerMB, halvingCount }
      });
      await transaction.save({ session });

      await session.commitTransaction();
      return { success: true, reward: finalReward };
    } catch (error) {
      await session.abortTransaction();
      console.error('❌ Mining reward failed:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Reward a user for social activity (likes, comments, etc.)
   */
  async rewardActivity(userId: string, activityType: 'like' | 'comment' | 'checkin' | 'receive_like' | 'view') {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const supplyConfig = await SystemConfig.findOne({ key: 'total_supply' }).session(session);
      const totalSupply = supplyConfig ? supplyConfig.value : 0;

      if (totalSupply >= this.MAX_SUPPLY) {
        await session.abortTransaction();
        return;
      }

      // Bot Detection
      if (securityService.isBotActivity(userId)) {
        await session.abortTransaction();
        return;
      }

      const user = await User.findById(userId).session(session);
      if (!user) throw new Error('User not found');

      let coinsToReward = 0;

      if (activityType === 'view') {
        user.watchedViewsCount += 1;
        if (user.watchedViewsCount >= this.VIEW_REWARD_THRESHOLD) {
          // Hit threshold! Reward user.
          // Implement a slight decay: first 100 videos full reward, then 50% reward, then 25%
          const dailyTotal = user.dailyMiningAmount;
          let multiplier = 1.0;
          if (dailyTotal > 100) multiplier = 0.5;
          if (dailyTotal > 300) multiplier = 0.25;

          coinsToReward = this.REWARD_VIEW * multiplier;
          user.watchedViewsCount = 0; // Reset counter for next milestone
        } else {
          // Just increment count and commit
          await user.save();
          await session.commitTransaction();
          return { success: true, reward: 0 };
        }
      } else {
        switch (activityType) {
          case 'like': coinsToReward = this.REWARD_LIKE; break;
          case 'comment': coinsToReward = this.REWARD_COMMENT; break;
          case 'checkin': coinsToReward = this.REWARD_CHECKIN; break;
          case 'receive_like': coinsToReward = this.REWARD_RECEIVE_LIKE; break;
        }
      }

      // Check Daily Cap
      const today = new Date().setHours(0, 0, 0, 0);
      const lastMining = user.lastMiningDate ? new Date(user.lastMiningDate).setHours(0, 0, 0, 0) : 0;
      
      if (lastMining < today) {
        user.dailyMiningAmount = 0;
      }

      if (user.dailyMiningAmount >= this.DAILY_MINING_CAP) {
        await session.abortTransaction();
        return;
      }

      // Enforce Cap
      coinsToReward = Math.min(coinsToReward, this.DAILY_MINING_CAP - user.dailyMiningAmount);

      if (coinsToReward <= 0) {
        await session.abortTransaction();
        return;
      }

      // Credit User & Update Limits
      user.minedCoins += coinsToReward;
      user.dailyMiningAmount += coinsToReward;
      user.lastMiningDate = new Date();
      await user.save();
      
      await SystemConfig.findOneAndUpdate({ key: 'total_supply' }, { $inc: { value: coinsToReward } }, { session });

      const transaction = new Transaction({
        receiverId: new mongoose.Types.ObjectId(userId),
        type: 'mining',
        amount: 0,
        coins: coinsToReward,
        status: 'completed',
        metadata: { activityType, info: 'Social Engagement Reward' }
      });
      await transaction.save({ session });

      await session.commitTransaction();
      return { success: true, reward: coinsToReward };
    } catch (error) {
      await session.abortTransaction();
      console.error('❌ Social reward failed:', error);
    } finally {
      session.endSession();
    }
  }

  /**
   * Periodic Reward Cycle
   * Distributes TTC-R based on accumulated points across the network.
   */
  async runRewardCycle(totalPoolAmount: number = 1000) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // 1. Get all active users with points > 0
      const activeUsers = await User.find({ 
        $or: [
          { 'miningPoints.viewer': { $gt: 0 } },
          { 'miningPoints.creator': { $gt: 0 } },
          { 'miningPoints.node': { $gt: 0 } }
        ]
      }).session(session);

      if (activeUsers.length === 0) {
        await session.abortTransaction();
        return;
      }

      // 2. Calculate totals
      const totalViewerPoints = activeUsers.reduce((sum, u) => sum + (u.miningPoints?.viewer || 0), 0);
      const totalCreatorPoints = activeUsers.reduce((sum, u) => sum + (u.miningPoints?.creator || 0), 0);
      const totalNodePoints = activeUsers.reduce((sum, u) => sum + (u.miningPoints?.node || 0), 0);

      // 3. Pool Shares
      const poolCreators = totalPoolAmount * this.PERCENT_CREATORS;
      const poolViewers = totalPoolAmount * this.PERCENT_VIEWERS;
      const poolNodes = totalPoolAmount * this.PERCENT_NODES;
      // Instruction Change: 100% of Node (WhaTaka) mining goes to Admin Incentive Pool
      const poolAdmin = totalPoolAmount * (this.PERCENT_ADMIN_INCENTIVE + this.PERCENT_NODES); 

      // 4. Distribute to users (Only Creators and Viewers now)
      for (const user of activeUsers) {
        let userReward = 0;
        
        if (totalViewerPoints > 0) {
          userReward += (user.miningPoints.viewer / totalViewerPoints) * poolViewers;
        }
        if (totalCreatorPoints > 0) {
          userReward += (user.miningPoints.creator / totalCreatorPoints) * poolCreators;
        }
        // Removed node points distribution as per user request (100% to admin)

        if (userReward > 0) {
          user.minedCoins += userReward; // ttcR in frontend
          // Reset points after reward
          user.miningPoints = { viewer: 0, creator: 0, node: 0 };
          await user.save({ session });

          // Log transaction
          const tx = new Transaction({
            receiverId: user._id,
            type: 'mining',
            amount: 0,
            coins: userReward,
            status: 'completed',
            metadata: { info: 'Usage Reward Cycle' }
          });
          await tx.save({ session });
        }
      }

      // 5. Accumulate Admin Incentive (BM-INCENTIVO-10%)
      const masterUser = await User.findOne({ email: this.MASTER_EMAIL }).session(session);
      if (masterUser) {
        masterUser.bmIncentivo = (masterUser.bmIncentivo || 0) + poolAdmin;
        await masterUser.save({ session });
        
        const adminTx = new Transaction({
          receiverId: masterUser._id,
          type: 'mining',
          amount: 0,
          coins: poolAdmin,
          status: 'completed',
          metadata: { info: 'BM-INCENTIVO-10% Accumulation' }
        });
        await adminTx.save({ session });
      }

      // Update Total Supply
      await SystemConfig.findOneAndUpdate(
        { key: 'total_supply' },
        { $inc: { value: totalPoolAmount } },
        { session }
      );

      await session.commitTransaction();
      console.log(`✅ Reward cycle completed. Distributed ${totalPoolAmount} TTC-R. Admin share: ${poolAdmin} TTC-R.`);
    } catch (error) {
      await session.abortTransaction();
      console.error('❌ Reward cycle failed:', error);
    } finally {
      session.endSession();
    }
  }

  /**
   * Track activity and assign points
   */
  async recordActivity(userId: string, creatorId: string, activity: { type: 'view' | 'like' | 'comment' | 'share' | 'live', duration?: number, isCompletion80?: boolean }) {
    try {
      const viewer = await User.findById(userId);
      const creator = await User.findById(creatorId);

      if (!viewer || !creator) return;

      let viewerPoints = 0;
      let creatorPoints = 0;

      switch (activity.type) {
        case 'view':
          if (activity.duration) {
            viewerPoints += Math.floor(activity.duration / 10) * this.POINTS_PER_10S_VIEW;
          }
          if (activity.isCompletion80) {
            viewerPoints += this.POINTS_VIEW_80_PERCENT;
          }
          creatorPoints = viewerPoints; // Creator gets same points as viewer for the view
          break;
        case 'like':
          viewerPoints += this.POINTS_LIKE;
          creatorPoints += this.POINTS_LIKE;
          break;
        case 'comment':
          viewerPoints += this.POINTS_COMMENT;
          creatorPoints += this.POINTS_COMMENT;
          break;
        case 'share':
          viewerPoints += this.POINTS_SHARE;
          creatorPoints += this.POINTS_SHARE;
          break;
        case 'live':
          if (activity.duration) {
            viewerPoints += activity.duration * this.POINTS_LIVE_PER_SEC;
            creatorPoints += activity.duration * this.POINTS_LIVE_PER_SEC;
          }
          break;
      }

      // Update viewer points
      viewer.miningPoints = viewer.miningPoints || { viewer: 0, creator: 0, node: 0 };
      viewer.miningPoints.viewer += viewerPoints;
      await viewer.save();

      // Update creator points
      creator.miningPoints = creator.miningPoints || { viewer: 0, creator: 0, node: 0 };
      creator.miningPoints.creator += creatorPoints;
      await creator.save();

    } catch (error) {
      console.error('Error recording activity points:', error);
    }
  }

  /**
   * Reward a specific action with a split between user and admin pool
   */
  async rewardActionWithSplit(userId: string, actionType: 'verification' | 'video_upload') {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = await User.findById(userId).session(session);
      if (!user) throw new Error('User not found');

      const rewards = {
        verification: 50, // 50 TTC for KYC
        video_upload: 10, // 10 TTC for upload
      };

      const totalReward = rewards[actionType] || 0;
      if (totalReward <= 0) {
        await session.abortTransaction();
        return;
      }

      // Split: 90% to user, 10% to admin incentive
      const userShare = totalReward * 0.9;
      const adminShare = totalReward * 0.1;

      user.minedCoins += userShare;
      await user.save({ session });

      // Update Admin Incentive
      const masterUser = await User.findOne({ email: this.MASTER_EMAIL }).session(session);
      if (masterUser) {
        masterUser.bmIncentivo = (masterUser.bmIncentivo || 0) + adminShare;
        await masterUser.save({ session });
      }

      // Update Total Supply
      await SystemConfig.findOneAndUpdate(
        { key: 'total_supply' },
        { $inc: { value: totalReward } },
        { session }
      );

      // Log transactions
      const userTx = new Transaction({
        receiverId: user._id,
        type: 'mining',
        amount: 0,
        coins: userShare,
        status: 'completed',
        metadata: { info: `Reward split for ${actionType}: User Share` }
      });
      await userTx.save({ session });

      if (masterUser) {
        const adminTx = new Transaction({
          receiverId: masterUser._id,
          type: 'mining',
          amount: 0,
          coins: adminShare,
          status: 'completed',
          metadata: { info: `Reward split for ${actionType}: Admin Share` }
        });
        await adminTx.save({ session });
      }

      await session.commitTransaction();
      return { success: true, reward: userShare };
    } catch (error) {
      await session.abortTransaction();
      console.error(`❌ Policy reward split failed for ${actionType}:`, error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Record WhaTaka Mining Report
   * Translates WhaTaka units into node points.
   */
  async recordMiningReport(userId: string, report: any) {
    try {
      const user = await User.findById(userId);
      if (!user) return;

      const { relay_units = 0, store_units = 0, uptime_units = 0, call_units = 0, reputation_units = 0 } = report;

      // Weights from whataka.txt: relay:5, store:8, uptime:1, call:10, reputation:3
      const points = 
        relay_units * 5 +
        store_units * 8 +
        uptime_units * 1 +
        call_units * 10 +
        reputation_units * 3;

      user.miningPoints = user.miningPoints || { viewer: 0, creator: 0, node: 0 };
      user.miningPoints.node += points;
      await user.save();
      
      console.log(`📡 [WhaTaka] Report recorded for ${userId}: +${points} node points`);
      return { success: true, pointsAdded: points };
    } catch (error) {
      console.error('Error recording mining report:', error);
      throw error;
    }
  }
}

export const miningService = new MiningService();
