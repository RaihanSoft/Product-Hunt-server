require('dotenv').config()

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.khjiv.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});


// Middleware
app.use(express.json());
app.use(cors({
    origin: [
        'http://localhost:5173',
    ],
    credentials: true,
}));
app.use(cookieParser());

const verifyToken = (req, res, next) => {

    const token = req.cookies?.token;
    if (!token) {
        return res.status(401).send({ message: 'Access denied' });
    }
    //verify token
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({ message: 'Invalid token' });
        }
        req.user = decoded;
        next()
    })
}


async function run() {
    try {
        await client.connect();
        console.log("Connected to MongoDB!");

        // Database and Collection references
        const productsCollection = client.db("products-hunt").collection("products");
        const reviewCollection = client.db("products-hunt").collection("reviews");
        const userCollection = client.db("products-hunt").collection("users");



        //JWT auth related api
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign({ ...user, _id: user._id }, process.env.JWT_SECRET, { expiresIn: '5h' })

            res.cookie('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict'
            })
                .send({ success: true })
        })


        //JWT auth related api
        app.post('/logout', async (req, res) => {

            res.clearCookie('token', {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict'
            })
                .send({ success: true })
        })



        //! start from here ......................................................

        // !1 product data add to database
        // Route to add a new product
        //   !1
        app.post('/products', async (req, res) => {
            const product = req.body;
            product.timestamp = new Date(); // Add timestamp
            product.votes = []; // Initialize votes as an empty array
            product.status = "pending"; // Set initial status to pending
            try {
                const result = await productsCollection.insertOne(product);
                res.status(201).json(result);
            } catch (error) {
                console.error("Error adding product:", error);
                res.status(500).json({ message: "Error adding product." });
            }
        });

        // !3

        // my products 

        app.get('/myProducts', verifyToken, async (req, res) => {
            const { email } = req.query;


            if (req.user.email !== email) {
                return res.status(403).send({ message: "Forbidden" })
            }


            if (!email) {
                return res.status(400).json({ message: "Email query parameter is required." });
            }

            try {
                const products = await productsCollection.find({ ownerEmail: email }).toArray();
                res.status(200).json(products);
            } catch (error) {
                console.error("Error fetching products:", error);
                res.status(500).json({ message: "Error fetching products." });
            }
        });

        //! start from here ...................................................d...
        //! start from here ...................................................d...


        // !2



    } catch (error) {
        console.error("Failed to connect to MongoDB:", error);
    }
}

run();

app.get('/', (req, res) => {
    res.send("Welcome to the Hotel Booking API!");
})

app.listen(port, () => {
    console.log(`Server running on port ${port}...`);
});
