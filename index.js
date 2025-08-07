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
        const addressCollections = db.collection("addressList");
        const unitCollections = db.collection("unitList");
        const referenceCollections = db.collection("referenceList");

        // **************************************************************************************************
        // **************************************************************************************************
        // __________________________________________________________________________________________________
        // all post api
        app.post("/submitDonation", async (req, res) => {
            try {
                let donation = req.body;
                donation.amount = Number(donation.amount) || 0;
                donation.quantity = Number(donation.quantity) || 0;
                // -----------------------------------------------------------------------------------------
                const isAddress = await addressCollections.findOne({ address: donation.address });
                if(!isAddress) {
                    await addressCollections.insertOne({ address: donation.address });
                }
                const isCategory = await incomeCategoriesCollections.findOne({ category: donation.incomeCategory });
                if(!isCategory) {
                    await incomeCategoriesCollections.insertOne({ category: donation.incomeCategory });
                }
                const isUnit = await unitCollections.findOne({ unit: donation.unit || "None" });
                if(!isUnit) {
                    await unitCollections.insertOne({ unit: donation.unit });
                }
                const isReference = await referenceCollections.findOne({ reference: donation.reference });
                if(!isReference) {
                    await referenceCollections.insertOne({ reference: donation.reference });
                }
                // -----------------------------------------------------------------------------------------

                if (!donation.donorId) {
                    // If donorId not provided, auto-generate it
                    const lastDonor = await donorCollections
                        .find({ donorId: { $exists: true } })
                        .sort({ donorId: -1 })
                        .limit(1)
                        .toArray();

                    const lastId = lastDonor?.[0]?.donorId || 10;
                    donation.donorId = lastId + 1;

                    await donorCollections.insertOne({
                        donorId: donation.donorId,
                        donorName: donation.donorName,
                        donorAddress: donation.address,
                        donorContact: donation.phone,
                        donateAmount: donation?.amount || 0,
                    });
                } else {
                    // Make sure donorID is a number
                    donation.donorId = Number(donation.donorId) || 0;
                    await donorCollections.updateOne(
                        { donorId: donation.donorId },
                        { $inc: { donateAmount: donation?.amount || 0 } },
                    )
                }

                const result = await donationCollections.insertOne(donation);
                res.send(result);
            } catch (error) {
                console.error("Submit Donation Error:", error);
                res.status(500).send({ message: "Internal server error" });
            }
        });

        // ___________________________________________________________________________________________________

        // **************************************************************************************************
        // All get api
        // ___________________________________________________________________________________________________
        app.get("/getDonorId/:id", verifyToken, async (req, res) => {
            const userEmailFromToken = req.user.email;
            const emailQuery = req.query.email;

            if (userEmailFromToken !== emailQuery) {
                return res.status(403).send({ message: "Forbidden Access" });
            }

            const donorId = parseInt(req.params.id);

            if (isNaN(donorId)) {
                return res.json({ message: "Invalid ID" });
            }

            try {
                const donor = await donorCollections.findOne({ donorId });
                if (!donor) return res.json({ message: "Donor not found" });

                res.send({
                    donorName: donor.donorName,
                    address: donor.donorAddress,
                    phone: donor.donorContact,
                });
            } catch (error) {
                // console.error("Get Donor Error:", error);
                res.json({ message: "Server error" });
            }
        });
        // ____________________________________________________________________________________________________

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
