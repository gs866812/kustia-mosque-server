const express = require("express");
const jwt = require("jsonwebtoken");
const bodyParser = require("body-parser");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const moment = require('moment-timezone');
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
        const expenseUnitCollections = db.collection("expenseUnitList");
        const referenceCollections = db.collection("referenceList");
        const expenseReferenceCollections = db.collection("expenseReferenceList");

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
                if (!isAddress) {
                    await addressCollections.insertOne({ address: donation.address });
                }
                const isCategory = await incomeCategoriesCollections.findOne({ category: donation.incomeCategory });
                if (!isCategory) {
                    await incomeCategoriesCollections.insertOne({ category: donation.incomeCategory });
                }
                const isUnit = await unitCollections.findOne({ unit: donation.unit || "None" });
                if (!isUnit) {
                    await unitCollections.insertOne({ unit: donation.unit });
                }
                const isReference = await referenceCollections.findOne({ reference: donation.reference });
                if (!isReference) {
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
        app.post("/submitExpense", async (req, res) => {
            try {
                let expense = req.body;
                expense.amount = Number(expense.amount) || 0;
                // -----------------------------------------------------------------------------------------
                const isCategory = await expenseCategoriesCollections.findOne({ category: expense.expenseCategory });
                if (!isCategory) {
                    await expenseCategoriesCollections.insertOne({ category: expense.expenseCategory });
                }

                const isUnit = await expenseUnitCollections.findOne({ unit: expense.unit || "None" });
                if (!isUnit) {
                    await expenseUnitCollections.insertOne({ unit: expense.unit });
                }

                const isReference = await expenseReferenceCollections.findOne({ reference: expense.reference });
                if (!isReference) {
                    await expenseReferenceCollections.insertOne({ reference: expense.reference });
                }
                // -----------------------------------------------------------------------------------------

                const result = await expenseCollections.insertOne(expense);
                res.send(result);
            } catch (error) {
                console.error("Submit Expense Error:", error);
                res.json({ message: "Internal server error" });
            }
        });

        // ___________________________________________________________________________________________________
        app.post("/addHadith", async (req, res) => {
            try {
                const hadith = req.body;
                const result = await hadithCollections.insertOne(hadith);
                res.send(result);

            } catch (error) {
                res.json({ message: "Internal server error" });
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
        app.get("/getInfo", verifyToken, async (req, res) => {
            const userEmailFromToken = req.user?.email;
            const emailQuery = req.query?.email;

            if (!userEmailFromToken || !emailQuery) {
                return res.status(400).send({ message: "Email is required" });
            }

            if (userEmailFromToken !== emailQuery) {
                return res.status(403).send({ message: "Forbidden Access" });
            }

            try {
                const address = await addressCollections.find().toArray();
                const incomeCategories = await incomeCategoriesCollections.find().toArray();
                const unit = await unitCollections.find().toArray();
                const reference = await referenceCollections.find().toArray();

                const expenseCategory = await expenseCategoriesCollections.find().toArray();
                const expenseUnit = await expenseUnitCollections.find().toArray();
                const expenseReference = await expenseReferenceCollections.find().toArray();

                res.send({
                    address: address.map(a => a.address),
                    incomeCategories: incomeCategories.map(c => c.category),
                    unit: unit.map(u => u.unit),
                    reference: reference.map(r => r.reference),
                    expenseCategory: expenseCategory.map(c => c.category),
                    expenseUnit: expenseUnit.map(u => u.unit),
                    expenseReference: expenseReference.map(r => r.reference),
                });
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: "Internal server error" });
            }
        });

        // ____________________________________________________________________________________________________
        app.get("/hadithList", verifyToken, async (req, res) => {
            const userEmailFromToken = req.user?.email;
            const emailQuery = req.query?.email;
            const search = req.query?.search || "";
            const page = parseInt(req.query?.page) || 1;
            const limit = parseInt(req.query?.limit) || 10;

            if (!userEmailFromToken || !emailQuery) {
                return res.status(400).send({ message: "Email is required" });
            }

            if (userEmailFromToken !== emailQuery) {
                return res.status(403).send({ message: "Forbidden Access" });
            }

            try {
                const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const query = {
                    $or: [
                        { hadith: { $regex: escapedSearch, $options: "i" } },
                        { date: { $regex: escapedSearch, $options: "i" } },
                    ]
                };

                const total = await hadithCollections.countDocuments(query);

                const hadithList = await hadithCollections
                    .find(query)
                    .skip((page - 1) * limit)
                    .limit(limit)
                    .toArray();

                res.send({
                    total,
                    data: hadithList
                });
            } catch (error) {
                console.error(error);
                res.status(500).json({ message: "Internal server error" });
            }
        });


        // ____________________________________________________________________________________________________
        app.get("/getFullHadithList", async (req, res) => {

            try {

                const hadithList = await hadithCollections.find().toArray();
                res.send(hadithList);
            } catch (error) {
                console.error(error);
                res.json({ message: "Internal server error" });
            }
        });

        // ____________________________________________________________________________________________________
        // Get distinct income categories
        app.get("/donationCategories", verifyToken, async (req, res) => {
            const userEmailFromToken = req.user?.email;
            const emailQuery = req.query?.email;

            if (!userEmailFromToken || !emailQuery) {
                return res.status(400).send({ message: "Email is required" });
            }
            if (userEmailFromToken !== emailQuery) {
                return res.status(403).send({ message: "Forbidden Access" });
            }

            try {
                // distinct returns an array
                const categories = await donationCollections.distinct("incomeCategory", {
                    incomeCategory: { $exists: true, $ne: "" },
                });

                // Optional: sort nicely (Bangla-friendly)
                const sorted = categories
                    .filter(Boolean)
                    .sort((a, b) => String(a).localeCompare(String(b), "bn"));

                res.send(sorted);
            } catch (error) {
                console.error("Get Donation Categories Error:", error);
                res.status(500).json({ message: "Internal server error" });
            }
        });

        // ____________________________________________________________________________________________________
        app.get("/donationList", verifyToken, async (req, res) => {
            const userEmailFromToken = req.user?.email;
            const emailQuery = req.query?.email;

            if (!userEmailFromToken || !emailQuery) {
                return res.status(400).send({ message: "Email is required" });
            }
            if (userEmailFromToken !== emailQuery) {
                return res.status(403).send({ message: "Forbidden Access" });
            }

            try {
                let {
                    search = "",
                    category = "",
                    startDate = "",
                    endDate = "",
                    page = 1,
                    limit = 10
                } = req.query;

                page = parseInt(page);
                limit = parseInt(limit);

                const query = {};

                // --- SEARCH ---
                // Covers strings & numbers; date is stored as string like "11.Aug.2025"
                if (search) {
                    const num = Number(search);
                    const isNum = !isNaN(num);

                    const or = [
                        { donorName: { $regex: search, $options: "i" } },
                        { address: { $regex: search, $options: "i" } },
                        { incomeCategory: { $regex: search, $options: "i" } },
                        { reference: { $regex: search, $options: "i" } },
                        { phone: { $regex: search, $options: "i" } },
                        { paymentOption: { $regex: search, $options: "i" } },
                        { unit: { $regex: search, $options: "i" } },
                        { month: { $regex: search, $options: "i" } },
                        { year: { $regex: search, $options: "i" } },
                        // date string search (e.g., "11.Aug.2025" or even "Aug")
                        { date: { $regex: search, $options: "i" } },
                    ];

                    if (isNum) {
                        or.push({ donorId: num });
                        or.push({ amount: num });
                        or.push({ quantity: num });
                    }

                    query.$or = or;
                }

                // --- CATEGORY FILTER ---
                if (category) {
                    query.incomeCategory = category;
                }

                // --- DATE RANGE (INCLUSIVE END) ---
                // Frontend sends ISO strings; we'll convert to Date and include full end-day.
                if (startDate && endDate) {
                    const start = new Date(startDate);
                    const end = new Date(endDate);
                    end.setHours(23, 59, 59, 999); // inclusive

                    // Your DB date is a string "DD.MMM.YYYY", parse inside query
                    query.$expr = {
                        $and: [
                            {
                                $gte: [
                                    {
                                        $dateFromString: {
                                            dateString: "$date",
                                            format: "%d.%b.%Y",
                                            onError: new Date(0),
                                        }
                                    },
                                    start
                                ]
                            },
                            {
                                $lte: [
                                    {
                                        $dateFromString: {
                                            dateString: "$date",
                                            format: "%d.%b.%Y",
                                            onError: new Date(0),
                                        }
                                    },
                                    end
                                ]
                            }
                        ]
                    };
                }

                // Totals over full filtered set (not just current page)
                const totals = await donationCollections.aggregate([
                    { $match: query },
                    {
                        $group: {
                            _id: null,
                            totalAmount: { $sum: { $ifNull: ["$amount", 0] } },
                            totalQuantity: { $sum: { $ifNull: ["$quantity", 0] } },
                            count: { $sum: 1 }
                        }
                    }
                ]).toArray();

                const totalAmount = totals[0]?.totalAmount || 0;
                const totalQuantity = totals[0]?.totalQuantity || 0;
                const totalCount = totals[0]?.count || 0;

                // Page data
                const data = await donationCollections
                    .find(query)
                    .sort({ _id: -1 })
                    .skip((page - 1) * limit)
                    .limit(limit)
                    .toArray();

                res.send({ data, totalAmount, totalQuantity, totalCount });
            } catch (error) {
                console.error("Get Donation List Error:", error);
                res.status(500).json({ message: "Internal server error" });
            }
        });


        // ____________________________________________________________________________________________________
        app.get("/expenseList", verifyToken, async (req, res) => {
            const userEmailFromToken = req.user?.email;
            const emailQuery = req.query?.email;

            if (!userEmailFromToken || !emailQuery) {
                return res.status(400).send({ message: "Email is required" });
            }
            if (userEmailFromToken !== emailQuery) {
                return res.status(403).send({ message: "Forbidden Access" });
            }

            try {
                let {
                    search = "",
                    category = "",
                    startDate = "",
                    endDate = "",
                    page = 1,
                    limit = 10
                } = req.query;

                page = parseInt(page);
                limit = parseInt(limit);

                const query = {};

                if (search) {
                    const num = Number(search);
                    const isNum = !isNaN(num);

                    const or = [
                        { expense: { $regex: search, $options: "i" } },
                        { expenseCategory: { $regex: search, $options: "i" } },
                        { reference: { $regex: search, $options: "i" } },
                        { note: { $regex: search, $options: "i" } },
                        { unit: { $regex: search, $options: "i" } },
                        { date: { $regex: search, $options: "i" } }, // "07.Aug.2025"
                        { month: { $regex: search, $options: "i" } },
                        { year: { $regex: search, $options: "i" } },
                    ];

                    if (isNum) {
                        or.push({ amount: num });
                        or.push({ quantity: num });
                    }
                    query.$or = or;
                }

                if (category) {
                    query.expenseCategory = category;
                }

                if (startDate && endDate) {
                    const start = new Date(startDate);
                    const end = new Date(endDate);
                    end.setHours(23, 59, 59, 999); // inclusive end

                    query.$expr = {
                        $and: [
                            {
                                $gte: [
                                    {
                                        $dateFromString: {
                                            dateString: "$date",
                                            format: "%d.%b.%Y",
                                            onError: new Date(0),
                                        }
                                    },
                                    start
                                ]
                            },
                            {
                                $lte: [
                                    {
                                        $dateFromString: {
                                            dateString: "$date",
                                            format: "%d.%b.%Y",
                                            onError: new Date(0),
                                        }
                                    },
                                    end
                                ]
                            }
                        ]
                    };
                }

                const totals = await expenseCollections.aggregate([
                    { $match: query },
                    {
                        $group: {
                            _id: null,
                            totalAmount: { $sum: { $ifNull: ["$amount", 0] } },
                            totalQuantity: { $sum: { $ifNull: ["$quantity", 0] } },
                            count: { $sum: 1 }
                        }
                    }
                ]).toArray();

                const totalAmount = totals[0]?.totalAmount || 0;
                const totalQuantity = totals[0]?.totalQuantity || 0;
                const totalCount = totals[0]?.count || 0;

                const data = await expenseCollections
                    .find(query)
                    .sort({ _id: -1 })
                    .skip((page - 1) * limit)
                    .limit(limit)
                    .toArray();

                res.send({ data, totalAmount, totalQuantity, totalCount });
            } catch (err) {
                console.error("Get Expense List Error:", err);
                res.status(500).json({ message: "Internal server error" });
            }
        });
        // ____________________________________________________________________________________________________
        app.delete("/hadith/:id", verifyToken, async (req, res) => {
            const userEmailFromToken = req.user?.email;
            const emailQuery = req.query?.email;
            if (!userEmailFromToken || !emailQuery) {
                return res.status(400).send({ message: "Email is required" });
            }
            if (userEmailFromToken !== emailQuery) {
                return res.status(403).send({ message: "Forbidden Access" });
            }
            const id = req.params.id;
            if (!id) {
                return res.status(400).send({ message: "ID is required" });
            }
            try {
                const result = await hadithCollections.deleteOne({ _id: new ObjectId(id) });
                if (result.deletedCount === 0) {
                    return res.status(404).send({ message: "Hadith not found" });
                }
                res.send(result);
            } catch (error) {
                console.error("Delete Hadith Error:", error);
                res.status(500).send({ message: "Internal server error" });
            }
        });
        // ____________________________________________________________________________________________________
        app.delete("/deleteDonation/:id", verifyToken, async (req, res) => {
            const userEmailFromToken = req.user?.email;
            const emailQuery = req.query?.email;
            if (!userEmailFromToken || !emailQuery) {
                return res.status(400).send({ message: "Email is required" });
            }
            if (userEmailFromToken !== emailQuery) {
                return res.status(403).send({ message: "Forbidden Access" });
            }
            const id = req.params.id;
            if (!id) {
                return res.status(400).send({ message: "ID is required" });
            }
            try {
                const result = await donationCollections.deleteOne({ _id: new ObjectId(id) });
                if (result.deletedCount === 0) {
                    return res.status(404).send({ message: "data not found" });
                }
                res.send(result);
            } catch (error) {
                console.error("Delete donation Error:", error);
                res.status(500).send({ message: "Internal server error" });
            }
        });
        // ____________________________________________________________________________________________________
        app.put("/editHadith/:id", verifyToken, async (req, res) => {
            const hadithId = req.params.id;
            const { hadith, email } = req.body;
            console.log(hadith, email);
            const userEmailFromToken = req.user?.email;

            if (!userEmailFromToken || !email) {
                return res.status(400).send({ message: "Email is required" });
            }

            if (userEmailFromToken !== email) {
                return res.status(403).send({ message: "Forbidden Access" });
            }

            if (!hadith || hadith.trim() === "") {
                return res.status(400).send({ message: "Hadith text is required" });
            }

            try {
                const result = await hadithCollections.updateOne(
                    { _id: new ObjectId(hadithId) },
                    { $set: { hadith: hadith } }
                );

                res.send(result); // result.modifiedCount will be checked by frontend
            } catch (error) {
                console.error("Error updating hadith:", error);
                res.status(500).send({ message: "Internal server error" });
            }
        });
        // ____________________________________________________________________________________________________
        // PUT: update a donation
        app.put("/updateDonation/:id", verifyToken, async (req, res) => {
            const { id } = req.params;
            const userEmailFromToken = req.user?.email;
            const emailQuery = req.query?.email;

            if (!userEmailFromToken || !emailQuery) {
                return res.status(400).send({ message: "Email is required" });
            }
            if (userEmailFromToken !== emailQuery) {
                return res.status(403).send({ message: "Forbidden Access" });
            }

            try {
                const {
                    date,           // "DD.MMM.YYYY"
                    amount,
                    quantity,
                    incomeCategory,
                    reference
                } = req.body || {};

                const $set = {};

                // date (strict parse + tz) + keep schema in sync
                if (typeof date === "string" && date.trim() !== "") {
                    const m = moment(date, "DD.MMM.YYYY", true).tz("Asia/Dhaka");
                    if (!m.isValid()) {
                        return res.status(400).send({
                            message: "Invalid date format. Use DD.MMM.YYYY (e.g., 07.Aug.2025)"
                        });
                    }
                    $set.date = m.format("DD.MMM.YYYY");
                    $set.month = m.format("MMMM"); // e.g., "August"
                    $set.year = m.format("YYYY");  // e.g., "2025"
                }

                // amount
                if (amount !== undefined) {
                    const num = Number(amount);
                    if (!Number.isFinite(num) || num < 0) {
                        return res.status(400).send({ message: "Invalid amount" });
                    }
                    $set.amount = num;
                }

                // quantity
                if (quantity !== undefined) {
                    const numQ = Number(quantity);
                    if (!Number.isFinite(numQ) || numQ < 0) {
                        return res.status(400).send({ message: "Invalid quantity" });
                    }
                    $set.quantity = numQ;
                }

                if (incomeCategory !== undefined) $set.incomeCategory = String(incomeCategory);
                if (reference !== undefined) $set.reference = String(reference);

                if (Object.keys($set).length === 0) {
                    return res.status(400).send({ message: "No valid fields to update" });
                }

                $set.updatedAt = new Date();

                const result = await donationCollections.updateOne(
                    { _id: new ObjectId(id) },
                    { $set }
                );

                return res.send({ modifiedCount: result.modifiedCount });
            } catch (err) {
                console.error("Update Donation Error:", err);
                return res.status(500).json({ message: "Internal server error" });
            }
        });

        // ____________________________________________________________________________________________________
        // PUT: update an expense
        app.put("/updateExpense/:id", verifyToken, async (req, res) => {
            const { id } = req.params;
            const userEmailFromToken = req.user?.email;
            const emailQuery = req.query?.email;

            if (!userEmailFromToken || !emailQuery) {
                return res.status(400).send({ message: "Email is required" });
            }
            if (userEmailFromToken !== emailQuery) {
                return res.status(403).send({ message: "Forbidden Access" });
            }

            try {
                const {
                    date,              // "DD.MMM.YYYY"
                    expense,           // string
                    amount,            // number
                    quantity,          // number
                    expenseCategory,   // string
                    reference,         // string
                    note               // string
                } = req.body || {};

                const $set = {};

                if (typeof date === "string" && date.trim() !== "") {
                    const m = moment(date, "DD.MMM.YYYY", true).tz("Asia/Dhaka");
                    if (!m.isValid()) {
                        return res.status(400).send({ message: "Invalid date format. Use DD.MMM.YYYY (e.g., 07.Aug.2025)" });
                    }
                    $set.date = m.format("DD.MMM.YYYY");
                    $set.month = m.format("MMMM");
                    $set.year = m.format("YYYY");
                }

                if (expense !== undefined) $set.expense = String(expense);

                if (amount !== undefined) {
                    const num = Number(amount);
                    if (!Number.isFinite(num) || num < 0) return res.status(400).send({ message: "Invalid amount" });
                    $set.amount = num;
                }

                if (quantity !== undefined) {
                    const numQ = Number(quantity);
                    if (!Number.isFinite(numQ) || numQ < 0) return res.status(400).send({ message: "Invalid quantity" });
                    $set.quantity = numQ;
                }

                if (expenseCategory !== undefined) $set.expenseCategory = String(expenseCategory);
                if (reference !== undefined) $set.reference = String(reference);
                if (note !== undefined) $set.note = String(note);

                if (Object.keys($set).length === 0) {
                    return res.status(400).send({ message: "No valid fields to update" });
                }

                $set.updatedAt = new Date();

                const result = await expenseCollections.updateOne(
                    { _id: new ObjectId(id) },
                    { $set }
                );

                res.send({ modifiedCount: result.modifiedCount });
            } catch (err) {
                console.error("Update Expense Error:", err);
                res.status(500).json({ message: "Internal server error" });
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
