const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

// Native require because it's a temp script
const UserSchema = new mongoose.Schema({
    email: String,
    minedCoins: Number,
    dailyMiningAmount: Number
}, { strict: false });

const ConfigSchema = new mongoose.Schema({
    key: String,
    value: mongoose.Schema.Types.Mixed
});

const User = mongoose.model('User', UserSchema);
const SystemConfig = mongoose.model('SystemConfig', ConfigSchema);

async function fixSupply() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to DB');

        const MASTER_EMAIL = 'eliecerdepablos@gmail.com';
        const NEW_SUPPLY = 50000000;

        // 1. Fix User Balance
        const user = await User.findOne({ email: MASTER_EMAIL });
        if (user) {
            user.minedCoins = NEW_SUPPLY;
            await user.save();
            console.log(`Updated user ${MASTER_EMAIL} balance to ${NEW_SUPPLY}`);
        } else {
            console.log('User not found');
        }

        // 2. Fix System Config
        await SystemConfig.findOneAndUpdate(
            { key: 'total_supply' },
            { value: NEW_SUPPLY },
            { upsert: true }
        );
        console.log(`Updated total_supply config to ${NEW_SUPPLY}`);

        console.log('Supply fix completed successfully');
        process.exit(0);
    } catch (err) {
        console.error('Fix failed:', err);
        process.exit(1);
    }
}

fixSupply();
