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
                let donation = req.body || {};

                // normalize numbers
                donation.amount = Number(donation.amount) || 0;
                donation.quantity = Number(donation.quantity) || 0;

                // sanitize strings
                donation.donorName = (donation.donorName || "").trim();
                donation.address = (donation.address || "").trim();
                donation.phone = (donation.phone || "").trim();
                donation.incomeCategory = (donation.incomeCategory || "").trim();
                donation.unit = (donation.unit || "").trim();
                donation.reference = (donation.reference || "").trim();

                // 1) Resolve donor
                let donorDoc = null;

                if (donation.donorId) {
                    // Provided: must exist
                    donation.donorId = Number(donation.donorId) || 0;
                    donorDoc = await donorCollections.findOne({ donorId: donation.donorId });

                    if (!donorDoc) {
                        return res.status(400).send({
                            message: `Invalid donorId: ${donation.donorId}. No donor found in donorCollections.`,
                        });
                    }

                    // Force donation fields from donorCollections (single source of truth)
                    donation.donorName = donorDoc.donorName || donation.donorName;
                    donation.address = donorDoc.donorAddress || donation.address;
                    donation.phone = donorDoc.donorContact || donation.phone;

                    // Increase donor's total donateAmount
                    await donorCollections.updateOne(
                        { donorId: donation.donorId },
                        { $inc: { donateAmount: donation.amount } }
                    );

                } else {
                    // Not provided: auto-create new donorId and donor doc
                    const lastDonor = await donorCollections
                        .find({ donorId: { $exists: true } })
                        .sort({ donorId: -1 })
                        .limit(1)
                        .toArray();

                    const lastId = lastDonor?.[0]?.donorId || 10;
                    const nextId = lastId + 1;

                    donorDoc = {
                        donorId: nextId,
                        donorName: donation.donorName,   // take from form
                        donorAddress: donation.address,  // take from form
                        donorContact: donation.phone,    // take from form
                        donateAmount: donation.amount || 0,
                        createdAt: new Date(),
                    };

                    // Insert donor
                    await donorCollections.insertOne(donorDoc);

                    // Force donation to match donor
                    donation.donorId = donorDoc.donorId;
                    donation.donorName = donorDoc.donorName;
                    donation.address = donorDoc.donorAddress;
                    donation.phone = donorDoc.donorContact;
                }

                // 2) Upsert auxiliary lists **after** we know final address/category/unit/reference
                if (donation.address) {
                    const isAddress = await addressCollections.findOne({ address: donation.address });
                    if (!isAddress) await addressCollections.insertOne({ address: donation.address });
                }

                if (donation.incomeCategory) {
                    const isCategory = await incomeCategoriesCollections.findOne({ category: donation.incomeCategory });
                    if (!isCategory) await incomeCategoriesCollections.insertOne({ category: donation.incomeCategory });
                }

                if (donation.unit) {
                    const isUnit = await unitCollections.findOne({ unit: donation.unit });
                    if (!isUnit) await unitCollections.insertOne({ unit: donation.unit });
                }

                if (donation.reference) {
                    const isReference = await referenceCollections.findOne({ reference: donation.reference });
                    if (!isReference) await referenceCollections.insertOne({ reference: donation.reference });
                }

                // 3) Insert donation (now guaranteed in sync with donor)
                const result = await donationCollections.insertOne(donation);
                return res.send(result);

            } catch (error) {
                console.error("Submit Donation Error:", error);
                return res.status(500).send({ message: "Internal server error" });
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
        // ===== ADD DONOR =====
        app.post("/addDonor", verifyToken, async (req, res) => {
            const userEmailFromToken = req.user?.email;
            const emailQuery = req.query?.email;

            if (!userEmailFromToken || !emailQuery) {
                return res.status(400).send({ message: "Email is required" });
            }
            if (userEmailFromToken !== emailQuery) {
                return res.status(403).send({ message: "Forbidden Access" });
            }

            try {
                const { donorName, donorAddress = "", donorContact = "" } = req.body || {};
                if (!donorName || !donorName.trim()) {
                    return res.status(400).send({ message: "Donor name is required" });
                }

                // auto-generate next donorId
                const last = await donorCollections
                    .find({ donorId: { $exists: true } })
                    .sort({ donorId: -1 })
                    .limit(1)
                    .toArray();
                const lastId = last?.[0]?.donorId || 10;
                const nextId = lastId + 1;

                const doc = {
                    donorId: nextId,
                    donorName: String(donorName).trim(),
                    donorAddress: String(donorAddress).trim(),
                    donorContact: String(donorContact).trim(),
                    donateAmount: 0,
                    createdAt: new Date()
                };

                const result = await donorCollections.insertOne(doc);
                res.send({ insertedId: result.insertedId });
            } catch (err) {
                console.error("Add Donor Error:", err);
                res.status(500).json({ message: "Internal server error" });
            }
        });
        // ___________________________________________________________________________________________________

        // **************************************************************************************************
        // All get api
        // ___________________________________________________________________________________________________
        app.get("/getDonorId/:id", verifyToken, async (req, res) => {
            const userEmailFromToken = req.user?.email;
            const emailQuery = req.query?.email;

            if (!userEmailFromToken || !emailQuery) {
                return res.status(400).send({ message: "Email is required" });
            }
            if (userEmailFromToken !== emailQuery) {
                return res.status(403).send({ message: "Forbidden Access" });
            }

            try {
                const rawId = req.params.id;
                const asNum = Number(rawId);
                const filter = Number.isFinite(asNum)
                    ? { $or: [{ donorId: asNum }, { donorId: String(asNum) }] }
                    : { donorId: rawId };

                const donor = await donorCollections.findOne(filter);
                if (!donor) return res.status(404).json({ message: "Donor not found" });

                // map correct fields
                return res.send({
                    donorName: donor.donorName || "",
                    address: donor.donorAddress || "",   // <-- key fix
                    phone: donor.donorContact || "",
                });
            } catch (error) {
                console.error("Get Donor Error:", error);
                return res.status(500).json({ message: "Server error" });
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
                // const expenseUnit = await expenseCollections.distinct("unit", {
                //     unit: { $exists: true, $ne: "" },
                // });


                // Optional: sort nicely (Bangla-friendly)
                // const sortedUnit = expenseUnit
                //     .filter(Boolean)
                //     .sort((a, b) => String(a).localeCompare(String(b), "bn"));

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
                const unit = await unitCollections.distinct("unit", {
                    unit: { $exists: true, $ne: "" },
                });
                const paymentOptions = await donationCollections.distinct("paymentOption", {
                    paymentOption: { $exists: true, $ne: "" },
                });


                // Optional: sort nicely (Bangla-friendly)
                const sorted = categories
                    .filter(Boolean)
                    .sort((a, b) => String(a).localeCompare(String(b), "bn"));
                const sortedUnit = unit
                    .filter(Boolean)
                    .sort((a, b) => String(a).localeCompare(String(b), "bn"));
                const sortedPayment = paymentOptions
                    .filter(Boolean)
                    .sort((a, b) => String(a).localeCompare(String(b), "bn"));

                res.send({ sorted, sortedUnit, sortedPayment });
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
        // ===== PUBLIC DONATIONS (list + totals) =====
        app.get("/public/donationList", async (req, res) => {
            try {
                let { search = "", category = "", startDate = "", endDate = "", page = 1, limit = 10 } = req.query;
                page = parseInt(page); limit = parseInt(limit);

                const query = {};

                if (search) {
                    const num = Number(search);
                    const isNum = !isNaN(num);
                    const or = [
                        { donorName: { $regex: search, $options: "i" } },
                        { address: { $regex: search, $options: "i" } },
                        { incomeCategory: { $regex: search, $options: "i" } },
                        { reference: { $regex: search, $options: "i" } },
                        { date: { $regex: search, $options: "i" } },
                        { month: { $regex: search, $options: "i" } },
                        { year: { $regex: search, $options: "i" } },
                    ];
                    if (isNum) { or.push({ amount: num }); or.push({ quantity: num }); or.push({ donorId: num }); }
                    query.$or = or;
                }
                if (category) query.incomeCategory = category;

                if (startDate && endDate) {
                    const start = new Date(startDate);
                    const end = new Date(endDate); end.setHours(23, 59, 59, 999);
                    query.$expr = {
                        $and: [
                            { $gte: [{ $dateFromString: { dateString: "$date", format: "%d.%b.%Y", onError: new Date(0) } }, start] },
                            { $lte: [{ $dateFromString: { dateString: "$date", format: "%d.%b.%Y", onError: new Date(0) } }, end] },
                        ],
                    };
                }

                const totals = await donationCollections.aggregate([
                    { $match: query },
                    { $group: { _id: null, totalAmount: { $sum: { $ifNull: ["$amount", 0] } }, totalQuantity: { $sum: { $ifNull: ["$quantity", 0] } }, count: { $sum: 1 } } }
                ]).toArray();

                const totalAmount = totals[0]?.totalAmount || 0;
                const totalQuantity = totals[0]?.totalQuantity || 0;
                const totalCount = totals[0]?.count || 0;

                const data = await donationCollections
                    .find(query, { projection: { donorName: 1, address: 1, amount: 1 } }) // only what the UI needs
                    .sort({ _id: -1 })
                    .skip((page - 1) * limit)
                    .limit(limit)
                    .toArray();

                res.send({ data, totalAmount, totalQuantity, totalCount });
            } catch (err) {
                console.error("Public Donation List Error:", err);
                res.status(500).json({ message: "Internal server error" });
            }
        });

        // ===== PUBLIC EXPENSES (list + totals) =====
        app.get("/public/expenseList", async (req, res) => {
            try {
                let { search = "", category = "", startDate = "", endDate = "", page = 1, limit = 10 } = req.query;
                page = parseInt(page); limit = parseInt(limit);

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
                        { date: { $regex: search, $options: "i" } },
                        { month: { $regex: search, $options: "i" } },
                        { year: { $regex: search, $options: "i" } },
                    ];
                    if (isNum) { or.push({ amount: num }); or.push({ quantity: num }); }
                    query.$or = or;
                }
                if (category) query.expenseCategory = category;

                if (startDate && endDate) {
                    const start = new Date(startDate);
                    const end = new Date(endDate); end.setHours(23, 59, 59, 999);
                    query.$expr = {
                        $and: [
                            { $gte: [{ $dateFromString: { dateString: "$date", format: "%d.%b.%Y", onError: new Date(0) } }, start] },
                            { $lte: [{ $dateFromString: { dateString: "$date", format: "%d.%b.%Y", onError: new Date(0) } }, end] },
                        ],
                    };
                }

                const totals = await expenseCollections.aggregate([
                    { $match: query },
                    { $group: { _id: null, totalAmount: { $sum: { $ifNull: ["$amount", 0] } }, totalQuantity: { $sum: { $ifNull: ["$quantity", 0] } }, count: { $sum: 1 } } }
                ]).toArray();

                const totalAmount = totals[0]?.totalAmount || 0;
                const totalQuantity = totals[0]?.totalQuantity || 0;
                const totalCount = totals[0]?.count || 0;

                const data = await expenseCollections
                    .find(query, { projection: { expense: 1, amount: 1 } }) // only what the UI shows
                    .sort({ _id: -1 })
                    .skip((page - 1) * limit)
                    .limit(limit)
                    .toArray();

                res.send({ data, totalAmount, totalQuantity, totalCount });
            } catch (err) {
                console.error("Public Expense List Error:", err);
                res.status(500).json({ message: "Internal server error" });
            }
        });

        // ===== PUBLIC PAYMENT INFO =====
        app.get("/public/paymentInfo", async (req, res) => {
            try {
                const payment = {
                    bkash: process.env.PAY_BKASH || "০১৩০৩৭৩১৫২৭",
                    nagad: process.env.PAY_NAGAD || "০১৩০৩৭৩১৫২৭",
                    bank: process.env.PAY_BANK || "Islami Bank: ২০৫০১৩৩০২০৫৪৪৩৭১৮",
                    address: process.env.PAY_ADDRESS || "চিথলিয়া কেন্দ্রীয় জামে মসজিদ, শাখাঃ কুষ্টিয়া",
                };
                res.send(payment);
            } catch (err) {
                console.error("Public Payment Info Error:", err);
                res.status(500).json({ message: "Internal server error" });
            }
        });

        // ____________________________________________________________________________________________________
        app.get("/donorList", verifyToken, async (req, res) => {
            const userEmailFromToken = req.user?.email;
            const emailQuery = req.query?.email;

            if (!userEmailFromToken || !emailQuery) {
                return res.status(400).send({ message: "Email is required" });
            }
            if (userEmailFromToken !== emailQuery) {
                return res.status(403).send({ message: "Forbidden Access" });
            }

            try {
                let { search = "", page = 1, limit = 10 } = req.query;
                page = parseInt(page); limit = parseInt(limit);

                const query = {};
                if (search) {
                    const num = Number(search);
                    const isNum = !isNaN(num);
                    const or = [
                        { donorName: { $regex: search, $options: "i" } },
                        { donorAddress: { $regex: search, $options: "i" } },
                        { donorContact: { $regex: search, $options: "i" } },
                    ];
                    if (isNum) {
                        or.push({ donorId: num });
                        or.push({ donateAmount: num });
                    }
                    query.$or = or;
                }

                const totals = await donorCollections.aggregate([
                    { $match: query },
                    { $group: { _id: null, totalCount: { $sum: 1 }, totalDonateAmount: { $sum: { $ifNull: ["$donateAmount", 0] } } } }
                ]).toArray();

                const totalCount = totals[0]?.totalCount || 0;
                const totalDonateAmount = totals[0]?.totalDonateAmount || 0;

                const data = await donorCollections
                    .find(query)
                    .sort({ _id: -1 }) // or { _id: -1 }
                    .skip((page - 1) * limit)
                    .limit(limit)
                    .toArray();

                res.send({ data, totalCount, totalDonateAmount });
            } catch (err) {
                console.error("Get Donor List Error:", err);
                res.status(500).json({ message: "Internal server error" });
            }
        });
        // ____________________________________________________________________________________________________
        app.get("/donorList/export", verifyToken, async (req, res) => {
            const userEmailFromToken = req.user?.email;
            const emailQuery = req.query?.email;

            if (!userEmailFromToken || !emailQuery) {
                return res.status(400).send({ message: "Email is required" });
            }
            if (userEmailFromToken !== emailQuery) {
                return res.status(403).send({ message: "Forbidden Access" });
            }

            try {
                let { search = "" } = req.query;

                const query = {};
                if (search) {
                    const num = Number(search);
                    const isNum = !isNaN(num);
                    const or = [
                        { donorName: { $regex: search, $options: "i" } },
                        { donorAddress: { $regex: search, $options: "i" } },
                        { donorContact: { $regex: search, $options: "i" } },
                    ];
                    if (isNum) {
                        or.push({ donorId: num });
                        or.push({ donateAmount: num });
                    }
                    query.$or = or;
                }

                // totals for the full filtered set
                const totals = await donorCollections.aggregate([
                    { $match: query },
                    {
                        $group: {
                            _id: null,
                            totalCount: { $sum: 1 },
                            totalDonateAmount: { $sum: { $ifNull: ["$donateAmount", 0] } },
                        },
                    },
                ]).toArray();

                const totalCount = totals[0]?.totalCount || 0;
                const totalDonateAmount = totals[0]?.totalDonateAmount || 0;

                // full data (no pagination)
                const data = await donorCollections
                    .find(query)
                    .sort({ _id: -1 })
                    .toArray();

                res.send({ data, totalCount, totalDonateAmount });
            } catch (err) {
                console.error("Export Donor List Error:", err);
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
        app.delete("/deleteExpense/:id", verifyToken, async (req, res) => {
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
                const result = await expenseCollections.deleteOne({ _id: new ObjectId(id) });
                if (result.deletedCount === 0) {
                    return res.status(404).send({ message: "data not found" });
                }
                res.send(result);
            } catch (error) {
                console.error("Delete expense Error:", error);
                res.status(500).send({ message: "Internal server error" });
            }
        });
        // ____________________________________________________________________________________________________// ===== DELETE DONOR (blocked if donations exist) =====
        app.delete("/deleteDonor/:id", verifyToken, async (req, res) => {
            const userEmailFromToken = req.user?.email;
            const emailQuery = req.query?.email;

            if (!userEmailFromToken || !emailQuery) {
                return res.status(400).send({ message: "Email is required" });
            }
            if (userEmailFromToken !== emailQuery) {
                return res.status(403).send({ message: "Forbidden Access" });
            }

            try {
                const id = req.params.id;
                if (!id) return res.status(400).send({ message: "ID is required" });

                const donor = await donorCollections.findOne({ _id: new ObjectId(id) });
                if (!donor) return res.status(404).send({ message: "Donor not found" });

                // prevent deleting if there are donations linked to this donorId
                // const hasDonations = await donationCollections.countDocuments({ donorId: donor.donorId });
                // if (hasDonations > 0) {
                //     return res.status(409).send({ message: "This donor has donations; delete blocked." });
                // }

                const result = await donorCollections.deleteOne({ _id: new ObjectId(id) });
                if (result.deletedCount === 0) {
                    return res.status(404).send({ message: "Donor not found" });
                }
                res.send(result);
            } catch (err) {
                console.error("Delete Donor Error:", err);
                res.status(500).json({ message: "Internal server error" });
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
                    donorName,
                    address,        // maps to donorAddress
                    phone,          // maps to donorContact
                    amount,
                    quantity,
                    incomeCategory,
                    unit,
                    paymentOption,
                    reference
                } = req.body || {};

                // --- 1) Load existing donation to compute delta & locate donor ---
                const oldDonation = await donationCollections.findOne({ _id: new ObjectId(id) });
                if (!oldDonation) {
                    return res.status(404).send({ message: "Donation not found" });
                }

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
                    $set.month = m.format("MMMM");
                    $set.year = m.format("YYYY");
                }

                // amount
                let newAmountForDelta = Number(oldDonation.amount || 0);
                if (amount !== undefined) {
                    const num = Number(amount);
                    if (!Number.isFinite(num) || num < 0) {
                        return res.status(400).send({ message: "Invalid amount" });
                    }
                    $set.amount = num;
                    newAmountForDelta = num;
                }

                // quantity
                if (quantity !== undefined) {
                    const numQ = Number(quantity);
                    if (!Number.isFinite(numQ) || numQ < 0) {
                        return res.status(400).send({ message: "Invalid quantity" });
                    }
                    $set.quantity = numQ;
                }

                if (donorName !== undefined) $set.donorName = String(donorName);
                if (address !== undefined) $set.address = String(address);
                if (phone !== undefined) $set.phone = String(phone);
                if (incomeCategory !== undefined) $set.incomeCategory = String(incomeCategory);
                if (unit !== undefined) $set.unit = String(unit);
                if (paymentOption !== undefined) $set.paymentOption = String(paymentOption);
                if (reference !== undefined) $set.reference = String(reference);

                if (Object.keys($set).length === 0) {
                    return res.status(400).send({ message: "No valid fields to update" });
                }

                $set.updatedAt = new Date();

                // --- 2) Update the donation itself ---
                const donationUpdateResult = await donationCollections.updateOne(
                    { _id: new ObjectId(id) },
                    { $set }
                );

                // --- 3) Update donor profile & donateAmount delta ---
                const prevAmount = Number(oldDonation.amount || 0);
                const delta = newAmountForDelta - prevAmount; // +ve => increase, -ve => decrease

                // Build a robust donor filter from donation
                let donorFilter = null;

                // Prefer an explicit reference if you have it on the donation:
                // e.g., oldDonation.donorObjectId or oldDonation.donorMongoId
                if (oldDonation.donorObjectId && ObjectId.isValid(oldDonation.donorObjectId)) {
                    donorFilter = { _id: new ObjectId(oldDonation.donorObjectId) };
                } else if (oldDonation.donorId !== undefined && oldDonation.donorId !== null) {
                    // donorId could be numeric (597) or a numeric string ("597")
                    const raw = oldDonation.donorId;
                    const asNumber = Number(raw);
                    if (Number.isFinite(asNumber)) {
                        donorFilter = { $or: [{ donorId: asNumber }, { donorId: String(asNumber) }] };
                    } else {
                        donorFilter = { donorId: raw };
                    }
                } else if (oldDonation.phone || phone) {
                    // Fallback by phone -> donorContact
                    const phoneVal = String(phone ?? oldDonation.phone).trim();
                    if (phoneVal) donorFilter = { donorContact: phoneVal };
                }

                if (donorFilter) {
                    const donorDoc = await donorCollections.findOne(donorFilter);

                    if (donorDoc) {
                        const donorSet = {};
                        if (donorName !== undefined) donorSet.donorName = String(donorName);
                        if (address !== undefined) donorSet.donorAddress = String(address);
                        if (phone !== undefined) donorSet.donorContact = String(phone);

                        if (delta !== 0) {
                            const currentTotal = Number(donorDoc.donateAmount || 0);
                            const nextTotal = Math.max(0, currentTotal + delta);
                            donorSet.donateAmount = nextTotal;
                        }

                        if (Object.keys(donorSet).length > 0) {
                            donorSet.updatedAt = new Date();
                            await donorCollections.updateOne({ _id: donorDoc._id }, { $set: donorSet });
                        }
                    }
                    // If no donor found, we silently skip; you can log if you want.
                }

                return res.send({ modifiedCount: donationUpdateResult.modifiedCount });
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
                    unit,            // string
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
                if (unit !== undefined) $set.unit = String(unit);
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
        // ===== UPDATE DONOR (no donorId change here) =====
        app.put("/updateDonor/:id", verifyToken, async (req, res) => {
            const userEmailFromToken = req.user?.email;
            const emailQuery = req.query?.email;

            if (!userEmailFromToken || !emailQuery) {
                return res.status(400).send({ message: "Email is required" });
            }
            if (userEmailFromToken !== emailQuery) {
                return res.status(403).send({ message: "Forbidden Access" });
            }

            const { id } = req.params;
            if (!ObjectId.isValid(id)) {
                return res.status(400).send({ message: "Invalid donor id" });
            }

            try {
                const { donorName, donorAddress, donorContact } = req.body || {};
                const $set = {};

                if (donorName !== undefined) $set.donorName = String(donorName).trim();
                if (donorAddress !== undefined) $set.donorAddress = String(donorAddress).trim();
                if (donorContact !== undefined) $set.donorContact = String(donorContact).trim();

                if (Object.keys($set).length === 0) {
                    return res.status(400).send({ message: "No valid fields to update" });
                }

                // Ensure donor exists and get donorId for propagation
                const donorDoc = await donorCollections.findOne(
                    { _id: new ObjectId(id) },
                    { projection: { donorId: 1 } }
                );
                if (!donorDoc) {
                    return res.status(404).send({ message: "Donor not found" });
                }

                $set.updatedAt = new Date();

                // 1) Update donor profile
                const donorUpdate = await donorCollections.updateOne(
                    { _id: new ObjectId(id) },
                    { $set }
                );

                // 2) Propagate changes to donations that share this donorId
                // Build a filter that matches both numeric and string forms
                const rawDonorId = donorDoc.donorId;
                const or = [];
                if (rawDonorId !== undefined && rawDonorId !== null) {
                    const asNum = Number(rawDonorId);
                    if (Number.isFinite(asNum)) {
                        or.push({ donorId: asNum }, { donorId: String(asNum) });
                    } else {
                        or.push({ donorId: rawDonorId });
                    }
                }

                // If you also store a direct link in donations (optional), you can include these:
                // or.push({ donorObjectId: id }, { donorMongoId: id });

                let donationMatched = 0;
                let donationModified = 0;

                if (or.length > 0) {
                    const donationSet = {};
                    if (donorName !== undefined) donationSet.donorName = String(donorName).trim();
                    if (donorAddress !== undefined) donationSet.address = String(donorAddress).trim();
                    if (donorContact !== undefined) donationSet.phone = String(donorContact).trim();

                    if (Object.keys(donationSet).length > 0) {
                        donationSet.updatedAt = new Date();
                        const donationsUpdate = await donationCollections.updateMany(
                            { $or: or },
                            { $set: donationSet }
                        );
                        donationMatched = donationsUpdate.matchedCount || 0;
                        donationModified = donationsUpdate.modifiedCount || 0;
                    }
                }

                return res.send({
                    modifiedCount: donorUpdate.modifiedCount,   // donor profile updated
                    donationMatched,
                    donationModified
                });
            } catch (err) {
                console.error("Update Donor Error:", err);
                return res.status(500).json({ message: "Internal server error" });
            }
        });

        // ____________________________________________________________________________________________________

        // **************************************************************************************************
        // ===== META MANAGER (income/expense categories, units, references) =====

        // Map UI 'kind' to collection + key + where it's used (for safe rename/delete)
        const metaKindMap = {
            addresses: {
                coll: addressCollections,
                key: "address",
                // No rename propagation target for addresses (leave usage undefined)
            },

            incomeCategories: {
                coll: incomeCategoriesCollections,
                key: "category",
                usage: { coll: donationCollections, field: "incomeCategory" },
            },
            expenseCategories: {
                coll: expenseCategoriesCollections,
                key: "category",
                usage: { coll: expenseCollections, field: "expenseCategory" },
            },
            units: {
                coll: unitCollections,
                key: "unit",
                usage: { coll: donationCollections, field: "unit" },
            },
            expenseUnits: {
                coll: expenseUnitCollections,
                key: "unit",
                usage: { coll: expenseCollections, field: "unit" },
            },
            references: {
                coll: referenceCollections,
                key: "reference",
                usage: { coll: donationCollections, field: "reference" },
            },
            expenseReferences: {
                coll: expenseReferenceCollections,
                key: "reference",
                usage: { coll: expenseCollections, field: "reference" },
            },
        };

        function getMetaConfig(kind) {
            const cfg = metaKindMap[kind];
            if (!cfg) throw new Error("Invalid kind");
            return cfg;
        }

        // GET /meta?kind=&search=&page=&limit=&email=
        app.get("/meta", verifyToken, async (req, res) => {
            const userEmailFromToken = req.user?.email;
            const emailQuery = req.query?.email;
            if (!userEmailFromToken || !emailQuery) return res.status(400).send({ message: "Email is required" });
            if (userEmailFromToken !== emailQuery) return res.status(403).send({ message: "Forbidden Access" });

            try {
                let { kind = "", search = "", page = 1, limit = 10 } = req.query;
                page = parseInt(page); limit = parseInt(limit);
                const { coll, key } = getMetaConfig(kind);

                const query = {};
                if (search) query[key] = { $regex: search, $options: "i" };

                const totalCount = await coll.countDocuments(query);
                const docs = await coll
                    .find(query)
                    .sort({ [key]: 1 })
                    .skip((page - 1) * limit)
                    .limit(limit)
                    .toArray();

                const data = docs.map(d => ({ _id: d._id, value: d[key] }));
                res.send({ data, totalCount });
            } catch (err) {
                console.error("Meta GET error:", err);
                res.status(500).json({ message: "Internal server error" });
            }
        });

        // POST /meta  body: { kind, value }
        app.post("/meta", verifyToken, async (req, res) => {
            const userEmailFromToken = req.user?.email;
            const emailQuery = req.query?.email;
            if (!userEmailFromToken || !emailQuery) return res.status(400).send({ message: "Email is required" });
            if (userEmailFromToken !== emailQuery) return res.status(403).send({ message: "Forbidden Access" });

            try {
                const { kind, value } = req.body || {};
                if (!kind || !value || !String(value).trim()) {
                    return res.status(400).send({ message: "kind and value are required" });
                }

                const { coll, key } = getMetaConfig(kind);
                const val = String(value).trim();

                const exists = await coll.findOne({ [key]: val });
                if (exists) return res.status(409).send({ message: "Already exists" });

                const result = await coll.insertOne({ [key]: val, createdAt: new Date() });
                res.send({ insertedId: result.insertedId });
            } catch (err) {
                console.error("Meta POST error:", err);
                res.status(500).json({ message: "Internal server error" });
            }
        });

        // PUT /meta/:id  body: { kind, value }  (propagate rename to usage docs)
        app.put("/meta/:id", verifyToken, async (req, res) => {
            const userEmailFromToken = req.user?.email;
            const emailQuery = req.query?.email;
            if (!userEmailFromToken || !emailQuery) return res.status(400).send({ message: "Email is required" });
            if (userEmailFromToken !== emailQuery) return res.status(403).send({ message: "Forbidden Access" });

            try {
                const { id } = req.params;
                const { kind, value } = req.body || {};
                if (!kind || !value || !String(value).trim()) {
                    return res.status(400).send({ message: "kind and value are required" });
                }

                const { coll, key, usage } = getMetaConfig(kind);
                const newVal = String(value).trim();

                const oldDoc = await coll.findOne({ _id: new ObjectId(id) });
                if (!oldDoc) return res.status(404).send({ message: "Not found" });
                const oldVal = oldDoc[key];

                if (oldVal === newVal) return res.send({ updated: false });

                const dup = await coll.findOne({ [key]: newVal });
                if (dup) return res.status(409).send({ message: "Value already exists" });

                const up = await coll.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { [key]: newVal, updatedAt: new Date() } }
                );

                if (usage?.coll && usage?.field) {
                    await usage.coll.updateMany(
                        { [usage.field]: oldVal },
                        { $set: { [usage.field]: newVal } }
                    );
                }

                res.send({ modifiedCount: up.modifiedCount, updated: true });
            } catch (err) {
                console.error("Meta PUT error:", err);
                res.status(500).json({ message: "Internal server error" });
            }
        });

        // DELETE /meta/:id?kind=&email=  (blocked if value is in use)
        app.delete("/meta/:id", verifyToken, async (req, res) => {
            const userEmailFromToken = req.user?.email;
            const emailQuery = req.query?.email;
            if (!userEmailFromToken || !emailQuery) return res.status(400).send({ message: "Email is required" });
            if (userEmailFromToken !== emailQuery) return res.status(403).send({ message: "Forbidden Access" });

            try {
                const { id } = req.params;
                const { kind } = req.query || {};
                if (!kind) return res.status(400).send({ message: "kind is required" });

                const { coll, key, usage } = getMetaConfig(kind);
                const doc = await coll.findOne({ _id: new ObjectId(id) });
                if (!doc) return res.status(404).send({ message: "Not found" });

                // const val = doc[key];

                // if (usage?.coll && usage?.field) {
                //     const inUse = await usage.coll.countDocuments({ [usage.field]: val });
                //     if (inUse > 0) return res.status(409).send({ message: "Value is in use; delete blocked." });
                // }

                const del = await coll.deleteOne({ _id: new ObjectId(id) });
                if (del.deletedCount === 0) return res.status(404).send({ message: "Not found" });

                res.send({ deletedCount: del.deletedCount });
            } catch (err) {
                console.error("Meta DELETE error:", err);
                res.status(500).json({ message: "Internal server error" });
            }
        });

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
