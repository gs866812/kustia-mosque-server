const express = require("express");
const jwt = require("jsonwebtoken");
const bodyParser = require("body-parser");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion } = require("mongodb");
require("dotenv").config();
// **************************************************************************************************
const app = express();
const PORT = process.env.PORT || 8000;
// **************************************************************************************************
app.use(cors({
    origin: process.env.FRONTEND_URL,
    credentials: true
}));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.json());
// **************************************************************************************************
const TOKEN_SECRET = process.env.TOKEN_SECRET;
const uri = process.env.MONGO_URI;
// **************************************************************************************************
const client = new MongoClient(uri, {
    serverApi: ServerApiVersion.v1,
});
// **************************************************************************************************

app.get("/", (req, res) => {
    res.send("Hello World!");
});
// **************************************************************************************************
// -------------------------------------------------------------------------------
const verifyToken = (req, res, next) => {
    const token = req.cookies.authToken;
    if (!token) return res.status(401).send({ message: "Unauthorized" });

    jwt.verify(token, TOKEN_SECRET, (err, decoded) => {
        if (err) return res.status(403).send({ message: "Forbidden" });
        req.user = decoded;
        next();
    });
};
// -------------------------------------------------------------------------------
app.post("/jwt", (req, res) => {
    const { email } = req.body;

    if (!email) return res.status(400).send({ message: "Email required" });

    const token = jwt.sign({ email }, TOKEN_SECRET, { expiresIn: "1h" });

    res.cookie("authToken", token, {
        httpOnly: true,
        secure: true,
        sameSite: "None",
        maxAge: 60 * 60 * 1000 // 1 hour
    }).send({ message: "Token issued" });
});
// --------------------------------------------------------------------------------
app.post("/logout", (req, res) => {
    res.clearCookie("authToken", {
        httpOnly: true,
        secure: true,
        sameSite: "None"
    });
    res.send({ message: "Logged out" });
});

// **************************************************************************************************
// **************************************************************************************************
async function run() {
    try {
        const db = client.db("mosqueData");
        const totalDonationBalanceCollections = db.collection("totalDonationBalanceList");
        const donationCollections = db.collection("donationList");
        const donorCollections = db.collection("donorList");
        const expenseCollections = db.collection("expenseList");
        const incomeCategoriesCollections = db.collection("incomeCategoriesList");
        const expenseCategoriesCollections = db.collection("expenseCategoriesList");
        const hadithCollections = db.collection("hadithList");

        // **************************************************************************************************
        // **************************************************************************************************




        // **************************************************************************************************
        // **************************************************************************************************
        console.log("MongoDB Connected");
    } finally {
        // await client.close(); // keep connection open
    }
}
run().catch(console.dir);

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
