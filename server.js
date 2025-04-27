const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const allowedOrigins = ['https://edu-pair-frontend.vercel.app'];
const app = express();

app.use(cors({
    origin: function (origin, callback) {
      // allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) === -1) {
        const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
        return callback(new Error(msg), false);
      }
      return callback(null, true);
    },
    credentials: true, // if you're sending cookies or auth headers
  }));

app.use(express.json());

const JWT_SECRET = "eduPairSecret"; // Replace with your own secret
app.options('*', cors());

mongoose.connect('mongodb+srv://hgauba4:v87Gbk3V3UqmUTyH@cluster0.cz5qf9b.mongodb.net/', { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("MongoDB connected"))
    .catch((err) => console.log(err));


// Middleware for protected routes
const authMiddleware = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: "Unauthorized" });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(401).json({ message: "Unauthorized" });
        req.user = user;
        next();
    });
};

// User Model
const userSchema = new mongoose.Schema({
    username: String,
    password: String,
    credits: { type: Number, default: 10 },
    bio: { type: String, default: '' },
    skills: [String],
    interests: [String],
    students: [String],
    sessions: [String], // store session IDs 
});

const User = mongoose.model('User', userSchema);

// Session Model
const sessionSchema = new mongoose.Schema({
    title: String,
    description: String,
    teacher: String,   // username of the teacher
    sessions:[String], // store session IDs
    students: [{
        type: String, // store usernames of students
        default: []   // default empty array
      }],
    creditsRequired: { type: Number, default: 5 },
    isBooked: { type: Boolean, default: false }
});
const Session = mongoose.model('Session', sessionSchema);

// Offer a session (with credits reward for teaching)
app.post('/offer-session', authMiddleware, async (req, res) => {
    const { title, description, creditsRequired } = req.body;

    if (!title || !description || !creditsRequired) {
        return res.status(400).json({ message: 'All fields are required' });
    }

    // Create the new session
    const newSession = new Session({
        title,
        description,
        teacher: req.user.username,
        creditsRequired,
    });

    await newSession.save();

    // Award 5 credits for offering a teaching session
    await User.updateOne({ username: req.user.username }, { $inc: { credits: 5 } });

    res.json({ message: 'Session offered successfully! You earned 5 credits.' });
});

// Get available sessions (exclude sessions already enrolled by the user)
app.get('/sessions', authMiddleware, async (req, res) => {
    try {
      const availableSessions = await Session.find({
        students: { $ne: req.user.username }, // user is not already enrolled
        teacher: { $ne: req.user.username }    // not the teacher's own session
      });
  
      res.json(availableSessions);
    } catch (err) {
      res.status(500).json({ message: 'Error retrieving sessions' });
    }
  });
  
  

// Get enrolled sessions for a user
app.get('/sessions/enrolled', authMiddleware, async (req, res) => {
    try {
      const sessions = await Session.find({ students: req.user.username });
      res.json(sessions);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Error fetching enrolled sessions" });
    }
  });



// Topic Model
const topicSchema = new mongoose.Schema({
    title: String,
    description: String,
    teacher: String, // username
    students: [String] // usernames
});
const Topic = mongoose.model('Topic', topicSchema);

// Register
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    const userExists = await User.findOne({ username });
    if (userExists) return res.status(400).json({ message: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword });
    await newUser.save();
    res.json({ message: "User registered" });
});

app.post('/signup', async (req, res) => {
    const { username, password } = req.body;
    const userExists = await User.findOne({ username });
    if (userExists) return res.status(400).json({ message: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword });
    await newUser.save();
    res.json({ message: "User registered" });
});

// Login
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(400).json({ message: "Invalid credentials" });

    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
});


app.post('/profile', authMiddleware, async (req, res) => {
    const { bio, skills, interests } = req.body;
    await User.updateOne({ username: req.user.username }, { bio, skills, interests });
    res.json({ message: "Profile updated" });
});

// Profile update route
app.put('/profile', authMiddleware, async (req, res) => {
    const { bio, skills, interests } = req.body;
    try {
      await User.updateOne(
        { username: req.user.username },
        { $set: { bio, skills, interests } }
      );
      res.json({ message: "Profile updated successfully!" });
    } catch (err) {
      res.status(500).json({ message: "Failed to update profile" });
    }
  });
  


// Get user details for the Dashboard
app.get('/dashboard', authMiddleware, async (req, res) => {
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ message: "User not found" });
  
    res.json({
      username: user.username,
      credits: user.credits,
      bio: user.bio,
      skills: user.skills,
      interests: user.interests,
    });
  });
  

// Enroll in a session (learn)
app.post('/sessions/:id/enroll', authMiddleware, async (req, res) => {
    const sessionId = req.params.id;
    const session = await Session.findById(sessionId);
    if (!session) return res.status(404).json({ message: "Session not found" });
  
    // Check if the user has enough credits to enroll
    const user = await User.findOne({ username: req.user.username });
    if (user.credits < session.creditsRequired) {
      return res.status(400).json({ message: "Not enough credits" });
    }
  
    // Check if the user is already enrolled in the session
    if (session.students.includes(req.user.username)) {
      return res.status(400).json({ message: "Already enrolled in this session" });
    }
  
    // Enroll the user in the session
    session.students.push(req.user.username);
    await session.save();
  
    // Add session ID to the user's list of enrolled sessions
    user.sessions.push(sessionId); // Assuming you have a `sessions` field in the user model
    await user.save();
  
    // Deduct credits from the user
    await User.updateOne({ username: req.user.username }, { $inc: { credits: -session.creditsRequired } });

    await User.updateOne(
        { username: session.teacher }, 
        { $inc: { credits: 10 } }  // Award 10 credits to the teacher (adjust the value as needed)
      );
  
    res.json({ message: "Successfully enrolled in the session" });
  });
  



// Get user details
app.get('/me', authMiddleware, async (req, res) => {
    const user = await User.findOne({ username: req.user.username });
    res.json({ username: user.username, credits: user.credits });
});

const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
