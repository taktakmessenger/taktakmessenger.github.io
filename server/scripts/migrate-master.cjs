const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    email: String,
    minedCoins: Number,
    bmIncentivo: Number,
    isWhaleOrBot: Boolean
}, { strict: false });

const User = mongoose.model('User', UserSchema);

async function migrateMaster() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to DB');

        const OLD_EMAIL = 'eliecerdepablos@gmail.com';
        const NEW_EMAIL = 'elmalayaso7@gmail.com';

        // 1. Find Old Master
        const oldUser = await User.findOne({ email: OLD_EMAIL });
        if (!oldUser) {
            console.log(`Old master ${OLD_EMAIL} not found.`);
        }

        // 2. Find or Create New Master
        let newUser = await User.findOne({ email: NEW_EMAIL });
        if (!newUser) {
            console.log(`Creating new master account ${NEW_EMAIL}`);
            newUser = new User({
                email: NEW_EMAIL,
                username: 'manchita1976_new',
                minedCoins: 0,
                bmIncentivo: 0,
                isWhaleOrBot: false
            });
        }

        // 3. Transfer Balance
        if (oldUser) {
            newUser.minedCoins = (newUser.minedCoins || 0) + (oldUser.minedCoins || 0);
            newUser.bmIncentivo = (newUser.bmIncentivo || 0) + (oldUser.bmIncentivo || 0);
            
            oldUser.minedCoins = 0;
            oldUser.bmIncentivo = 0;
            await oldUser.save();
            console.log(`Transferred balance from ${OLD_EMAIL} to ${NEW_EMAIL}`);
        } else {
            // If old user doesn't exist, just ensure new user has 50M
            newUser.minedCoins = 50000000;
            console.log(`Set ${NEW_EMAIL} balance to 50,000,000 TTC`);
        }

        await newUser.save();
        console.log('Migration completed successfully');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrateMaster();
