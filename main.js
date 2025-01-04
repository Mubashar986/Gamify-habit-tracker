const express=require('express');
const server=express();
server.set('view engine','ejs')
server.use(express.urlencoded({extended : true}));
const Users=require('../Gamify-habit-tracker/models/usersModel');
const Requests=require('../Gamify-habit-tracker/models/friendRequest');
const Challenges=require('../Gamify-habit-tracker/models/challenges');
const Potion=require('../Gamify-habit-tracker/models/Potion');
const Habit= require('../Gamify-habit-tracker/models/habits');
const Avatar=require('../Gamify-habit-tracker/models/avatar');
const DailyStreaks = require('../Gamify-habit-tracker/models/dailyStreaks');
const Leaderboard=require('../Gamify-habit-tracker/models/leaderboard');
const { calculateCoinsForStreak } = require('./public/javascript/calculateCoins');
const { calculatePoints } = require('./public/javascript/calculatePoints');
const auth = require('./middleware/auth');
const mongoose = require('mongoose');
let cookieParser = require("cookie-parser");
let session = require("express-session");
server.use(express.static('public'));
server.use(express.static('uploads'));
server.use(cookieParser());
server.use(session({ secret: "my session secret" }));
let currentUserName='';

let multer = require("multer");
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "./uploads");
  },
  filename: function (req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({ storage: storage });

async function performDailyUpdates() {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);

        await Habit.updateMany(
            { isCompletedToday: true },
            {
                $set: {
                    isCompletedToday: false,
                },
            }
        );

        await Habit.updateMany(
            { lastCheckIn: { $lt: yesterday.toISOString() } },
            {
                $set: {
                    streak: 0,
                },
            }
        );

        const users = await Users.find();

        users.forEach(async user => {
            const currentDate = new Date();
    
            user.inventory = user.inventory.filter(item => {
                if (item.expirationDate && currentDate > item.expirationDate) {
                    console.log(`Potion with ID ${item.potionId} expired for user ${user.username}.`);
                    return false; // Remove expired potion
                }
                return true;
            });
    
            await user.save();
        });
    
        console.log('Potion expiration cleanup completed!');

        console.log("Daily updates performed successfully.");
    } catch (error) {
        console.error("Error performing daily updates:", error);
    }
}


async function checkAndPerformDailyUpdates() {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let streakData = await DailyStreaks.findOne();

        if (!streakData) {
            streakData = new DailyStreaks({ lastUpdateDate: new Date(0) });
            await streakData.save();
        }

        const lastUpdateDate = new Date(streakData.lastUpdateDate);

        if (lastUpdateDate.getTime() !== today.getTime()) {
            await performDailyUpdates();

            streakData.lastUpdateDate = today;
            await streakData.save();
        }
        else{
            console.log('Already performed updates today')
        }
    } catch (error) {
        console.error("Error during daily updates check:", error);
    }
}

checkAndPerformDailyUpdates();

server.get('/',(req,res)=>{
    res.render('Registration/login');
})




server.get('/home', auth, async (req, res) => {
    try {
        const user = await Users.findOne({ username: req.cookies.username });
        currentUserName=req.cookies.username;
        if (!user) return res.status(404).send('User not found');
        res.render('Homepage', { user });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server error');
    }
});

server.post('/signup',async(req,res)=>{
    let data=req.body;
    let newUser=Users(data);

    
    
    try {
        const doesUserExistAlready = await Users.findOne({ username: newUser.username });

        if (doesUserExistAlready) {
            return res.render('Registration/Login', { error: 'User already exists' });
        }
        await newUser.save();
        res.cookie('username', newUser.username, {
            maxAge: (3600*(1000)), 
            httpOnly: true, 
            secure: true,   
            sameSite: 'Strict' 
        });
        currentUserName=newUser.username;
        const user=await Users.findOne({username:currentUserName});
        return res.render('Homepage',{user});
    } catch (error) {
        console.error("Error occurred:", error);
        return res.status(500).send('An unexpected error occurred.');
    }
})

server.post('/login',async(req,res)=>{
    let data = req.body;
    let isUserValid=new Users(data);
    if(await Users.findOne({username : isUserValid.username , password : isUserValid.password})){
        currentUserName=req.cookies.username;
        
        res.cookie('username', isUserValid.username, {
            maxAge: 3600000, 
            httpOnly: true, 
            secure: true,   
            sameSite: 'Strict' 
        });
        return res.redirect('/home');
    }
    return res.render('Registration/Login', { error: 'No Such User exists' });
})

server.get('/logout',(req,res)=>{
    res.clearCookie('username');
    res.redirect('/');
})

server.get('/friendRequests',auth,async(req,res)=>{
    const sentRequests=await Requests.find({senderUsername : req.cookies.username});
    const requests=await Requests.find({receiverUsername : req.cookies.username});
    const currentUser=await Users.findOne({username:req.cookies.username});
    try{
        const friendsList=await Users.find({username : {$in : currentUser.friends}});
        const suggestedFriendsList=await Users.find({username : {$nin : currentUser.friends }});
        res.render('friendRequests.ejs',{friendsList,suggestedFriendsList,currentUser,requests,sentRequests,user:currentUser});
    }catch(err){
        const suggestedFriendsList=await Users.find();
        res.render('friendRequests.ejs',{suggestedFriendsList,currentUser,requests,sentRequests,user:currentUser});
    }
    
})

server.get('/addFriend/:username/:currusername',async(req,res)=>{
    const receiverUsername = req.params['username'];
    const senderUsername = req.params['currusername'];
    const newRequest=new Requests({
        senderUsername,
        receiverUsername
    })
    await newRequest.save();
    res.redirect('/friendRequests');
})

server.get('/confirmRequests/:senderUsername/:receiverUsername',async(req,res)=>{
    const receiver = await Users.findOne({ username: req.params['receiverUsername'] });
    const sender = await Users.findOne({ username: req.params['senderUsername'] });
    receiver.friends.push(req.params['senderUsername']);
    sender.friends.push(req.params['receiverUsername']);
    await receiver.save();
    await sender.save();
    await Requests.findOneAndDelete({
        receiverUsername : req.params['receiverUsername'],
        senderUsername : req.params['senderUsername']
    });
    res.redirect('/friendRequests');
})

server.get('/deleteRequest/:senderUsername/:receiverUsername',async(req,res)=>{
    await Requests.findOneAndDelete({
        receiverUsername : req.params['receiverUsername'],
        senderUsername : req.params['senderUsername']
    });
    res.redirect('/friendRequests');
})

server.get('/progress',(req,res)=>{
    console.log(req.cookies.username);
    res.render('progressBar');
})



server.get('/createChallenge',auth,async(req,res)=>{
    const currentUser=await Users.findOne({username:req.cookies.username});
    const participants=await Users.find({username : {$in : currentUser.friends}});
    res.render('createChallenge',{participants});
})

server.post('/createChallenge',auth, async (req, res) => {
    try {
        const { title, description, startDate, endDate, difficulty, category, targetGoal, points, participants} = req.body;

        // Transform participants into objects with `username` and `status`
        const normalizedParticipants = Array.isArray(participants)
            ? participants
            : [participants];

        // Transform participants into objects with `username` and `status`
        const formattedParticipants = normalizedParticipants.map(participant => ({
            username: participant,
            status: "pending", 
        }));

        let creator=req.cookies.username;

        // Create a new challenge
        const newChallenge = new Challenges({
            title,
            description,
            startDate,
            endDate,
            difficulty,
            category,
            points,
            participants: formattedParticipants,
            creator
        });

        await newChallenge.save();
        res.render('getStarted');
    } catch (err) {
        console.error(err);
        res.status(500).send("Failed to create challenge");
    }
});

server.get('/Challenges',auth,async(req,res)=>{
    const user=await Users.findOne({username:req.cookies.username});
    res.render('Challenges',{user});
})


server.get('/challengeRequests',auth, async (req, res) => {
    const currentUser = await Users.findOne({ username: req.cookies.username });
    const challenges = await Challenges.find({
        participants: { $elemMatch: { username: currentUser.username, status: "pending" }
    }});

    res.render('challengeRequests', { challenges });
});

server.post('/acceptChallenge/:id',auth, async (req, res) => {
    const challengeId = req.params.id;await Challenges.updateOne(
        { _id: challengeId, "participants.username": req.cookies.username },
        { $set: { "participants.$.status": "accepted" } }
    );

    res.redirect('/challengeRequests');
});

server.post('/declineChallenge/:id',auth, async (req, res) => {
    const challengeId = req.params.id;
    await Challenges.updateOne(
        { _id: challengeId, "participants.username": req.cookies.username },
        { $set: { "participants.$.status": "declined" } }
    );

    res.redirect('/challengeRequests');
});

server.get('/viewChallenges',auth, async (req, res) => {
    try {

        const challenges = await Challenges.find({
            "participants.username": req.cookies.username,
        });

        res.render('viewChallenges', { challenges, currentUserName:req.cookies.username });
    } catch (err) {
        console.error(err);
        res.status(500).send("Failed to fetch challenges.");
    }
});

server.post("/completeChallenge",auth, async (req, res) => {
    try {
        const challengeId= req.body.challengeId;
        const basePoints = Number(req.body.points);
        console.log('Challenge bonus points : '+basePoints);
        await Challenges.updateOne(
            { _id: challengeId, "participants.username": currentUserName },
            { $set: { "participants.$.status": "completed" } }
        );

        
        const requsername = currentUserName;
        const user=await Users.findOne({username:currentUserName})
        currentUserName.coins += (basePoints)/4;
        const bonusPoints=calculatePoints(basePoints,user);
        const leaderboardResult=await Leaderboard.findOneAndUpdate(
            { username: requsername },
            { $inc: { points: bonusPoints } },
            { upsert: true, new: true }
        );

        if (leaderboardResult.points >= leaderboardResult.level *100){
            await Leaderboard.updateOne({username:currentUserName},{ $inc:{level: 1}});
        }

        console.log("Challenge completed! Bonus points added.");
        res.redirect('/viewChallenges')
    } catch (error) {
        console.error("Error updating leaderboard for challenge:", error);
        res.status(500).send("An error occurred while completing the challenge.");
    }
});


server.get("/leaderboard",auth, async (req, res) => {
    try {
        const leaderboard = await Leaderboard.find().sort({ points: -1 }).limit(10);
        const user=await Users.findOne({username:req.cookies.username})
        res.render("leaderboard", { leaderboard,user });
    } catch (error) {
        console.error("Error fetching leaderboard:", error);
        res.status(500).send("Error loading leaderboard.");
    }
});


server.get('/habits',auth, async (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    console.log(today);
    const user=await Users.findOne({username:req.cookies.username});
    const habits = await Habit.find({ username : req.cookies.username});

    const dueHabits = habits.filter(habit => habit.isCompletedToday!=true );
    const completedHabits = habits.filter(habit => habit.isCompletedToday ==true);

    res.render('habits/habits', {habits, dueHabits, completedHabits,user });
});

server.get("/createHabit",auth,(req,res)=>{
    res.render("habits/createHabit");
})

server.post("/createHabit",auth,async(req,res)=>{
        let data=req.body;
        data.username=req.cookies.username;
        let newHabit=new Habit(data);
        await newHabit.save();
        res.redirect('/habits');
});

server.get("/checkInHabit/:_id",auth, async (req, res) => {
    try {
        
        const habitResult = await Habit.updateOne(
            { _id: req.params._id, isCompletedToday: false },
            {
                $set: {
                    isCompletedToday: true,
                    lastCheckIn: new Date().toISOString(),
                },
                $inc: { streak: 1 },
            }
        );

        const user=await Users.findOne({username:req.cookies.username});
        const basePoints = 5;
        const pointsToAdd=calculatePoints(basePoints,user);
        const leaderboardResult = await Leaderboard.findOneAndUpdate(
            { username: currentUserName },
            { $inc: { points: pointsToAdd } },
            { upsert: true, new: true } 
        );
        if (leaderboardResult.points >= leaderboardResult.level *100){
            await Leaderboard.updateOne({username:req.cookies.username},{ $inc:{level: 1}});
        }

        let habit= await Habit.findOne({_id:req.params._id});
        const coins = calculateCoinsForStreak(habit.streak);
        if (coins > 0) {
            const user = await Users.findOne({username:habit.username});
            user.coins += coins;
            await user.save();
        }

        res.redirect('/habits');
    } catch (error) {
        console.error("Error updating habit and leaderboard:", error);
        res.status(500).send("An error occurred while checking in the habit.");
    }
});


server.get('/removeHabit/:_id',auth,async(req,res)=>{
    await Habit.deleteOne({ _id: req.params._id});
    res.redirect('/habits');
})

server.post('/shop/buy-avatar/:id',auth, async (req, res) => {
    try {
        const avatar = await Avatar.findOne({_id:req.params.id});
        console.log(avatar);
        const user = await Users.findOne({username:req.cookies.username}); // Assuming req.user contains authenticated user details

        if (user.coins < avatar.cost) {
            return res.status(400).send('Not enough coins to purchase this avatar.');
        }

        // Deduct coins and update the user's avatar
        user.coins -= avatar.cost;
        user.avatar.avatarId = req.params.id;
        user.avatar.imageURL = avatar.imageURL;

        await user.save();
        res.redirect('/shop'); // Redirect back to shop after purchase
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

server.post('/shop/buy-potion/:potionId',auth, async (req, res) => {

    try {
        const user = await Users.findOne({username: req.cookies.username}); // Assuming req.user contains authenticated user data
        const potion = await Potion.findOne({_id:req.params.potionId});

        if (!potion) return res.status(404).json({ message: 'Potion not found' });

        // Check if user has enough coins
        if (user.coins < potion.cost) {
            return res.status(400).json({ message: 'Not enough coins to buy this potion' });
        }

        // Deduct coins
        user.coins -= potion.cost;

        // Add potion to user's inventory
        if (!user.inventory)
            user.inventory = [];

        user.inventory.push({
            potionId: potion._id,
            effectType: potion.effectType,
            duration: potion.duration,
            activatedAt: null, // Set to null initially
            expirationDate: null, // Set to null initially
            imageURL: potion.imageURL,
            description: potion.description,
            cost: potion.cost,
        });

        await user.save();

        res.redirect('/shop');
    } catch (error) {
        console.error(error);
        res.status(500).send('Server error');
    }
});

server.get('/admin',auth,async(req,res)=>{
    const avatar=await Avatar.find();
    const potion=await Potion.find();
    const user=await Users.findOne({username: req.cookies.username});
    res.render('admin/admin.ejs',{avatar,potion,userAvatarId:user.avatar.avatarId})
})

server.get('/createPotion',auth,async(req,res)=>{
    res.render('admin/newPotionForm.ejs');
})

server.post('/createPotion',upload.single("file"),async (req, res) => {
    let data = {
        name: req.body.name,
        effectType: req.body.effectType,
        duration: Number(req.body.duration), 
        cost: Number(req.body.cost), 
        description: req.body.description,
        imageURL: req.file ? req.file.filename : req.body.imageURL 
    };
    let newPotion= new Potion(data);
    await newPotion.save();
    res.redirect('/admin');
})

server.get('/editAvatar/:id',auth,async(req,res)=>{
    const avatar=await Avatar.findOne({_id:req.params.id});
    res.render('admin/editAvatarForm',{avatar,avatarId:req.params.id});
})

server.get('/deleteAvatar/:id',auth,async(req,res)=>{
    await Avatar.deleteOne({_id:req.params.id});
    res.redirect('/admin');
});

server.post('/editAvatar/:id',auth,async(req,res)=>{
    const avatar=await Avatar.findOne({_id:req.params.id});
    let data = req.body;
    avatar.name = data.name;
    avatar.cost = data.cost;
    avatar.description = data.description;
    await avatar.save();
    res.redirect('/admin');
})

server.get('/createAvatar',(req,res)=>{
    res.render('admin/newAvatarForm.ejs');
})

server.post('/createAvatar',upload.single("file"),async (req, res) => {
    let data = req.body;
    let newAvatar= new Avatar(data);
    if (req.file) {
        newAvatar.imageURL = req.file.filename;
    }
    await newAvatar.save();
    res.redirect('/admin');
})

server.get('/shop',auth, async (req, res) => {
    let avatars = await Avatar.find();
    let potions = await Potion.find();
    const user = await Users.findOne({ username: req.cookies.username });
    let userAvatar = null;

    const allPotions = await Potion.find();

        // Extract potion IDs from the user's inventory
    const purchasedPotionIds = user.inventory.map(item => item.potionId.toString());

        // Categorize potions
    const purchasedPotions = allPotions.filter(potion => purchasedPotionIds.includes(potion._id.toString()));
    const notPurchasedPotions = allPotions.filter(potion => !purchasedPotionIds.includes(potion._id.toString()));


    if (user.avatar.avatarId) {
        userAvatar = await Avatar.findOne({ _id: user.avatar.avatarId });
    }

    res.render('shop', { purchasedPotions,notPurchasedPotions, avatars, user, userAvatar });
});

server.get('/inventory',auth, async (req, res) => {
    const user = await Users.findOne({ username: req.cookies.username });
    const currentDate = new Date();

    // Check for expired potions
    user.inventory = user.inventory.filter(item => {
        if (item.expirationDate && currentDate > item.expirationDate) {
            console.log('Potion with ID ${item.potionId} has expired.');
            return false; // Remove expired potion
        }
        return true; // Keep valid potion
    });
    let userAvatar = null;

    // Fetch user's avatar if it exists
    if (user.avatar.avatarId) {
        userAvatar = await Avatar.findOne({ _id: user.avatar.avatarId });
    }

    await user.save();
    res.render('inventory', {userAvatar,user, potions: user.inventory });
});



server.post('/activatePotion/:id',auth, async (req, res) => {
    const user = await Users.findOne({ username: req.cookies.username });
    const potionId = req.params.id;

    const potion = user.inventory.find(item => item.potionId.toString() === potionId);
    console.log(potion);
    if (potion) {
        if (!potion.activatedAt) {
            const currentDate = new Date();
            potion.activatedAt = currentDate;
            potion.expirationDate = new Date(currentDate.getTime() + potion.duration * 24 * 60 * 60 * 1000);
            await user.save();
            console.log('Potion activated successfully!');
            res.redirect('/inventory');
        } else {
            res.send('Potion is already activated!');
        }
    } else {
        res.status(404).send('Potion not found!');
        console.log(potionId)
    }
});




server.listen(5000,()=>{
    console.log("Server running on port 5000")
})

let connectionString='mongodb://localhost/Users';
mongoose.connect(connectionString)
.then(console.log('Successfully connected to '+connectionString))
.catch(err=>console.log("error occured : \n"+err));