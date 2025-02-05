require('dotenv').config()

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

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
        'https://product-hunt-9fc9a.web.app',
        'https://product-hunt-9fc9a.firebaseapp.com'
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
        // await client.connect();
        console.log("Connected to MongoDB!");

        // Database and Collection references
        const productsCollection = client.db("products-hunt").collection("products");
        const reviewCollection = client.db("products-hunt").collection("reviews");
        const userCollection = client.db("products-hunt").collection("users");
        const couponsCollection = client.db("products-hunt").collection("coupons");
        const paymentsCollection = client.db("products-hunt").collection("payments");



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


        // Route to add a new product
        //   !1
        app.post('/products', async (req, res) => {
            const product = req.body;
            product.timestamp = new Date(); // Add timestamp
            product.votes = [];
            product.status = "pending";
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
        app.get('/all-products', async (req, res) => {
            const { search, page = 1, limit = 6 } = req.query;
            const query = search ? { tags: { $regex: search, $options: 'i' } } : {};
            const options = {
                sort: { timestamp: -1 },
                skip: (page - 1) * limit,
                limit: parseInt(limit),
            };

            try {
                const products = await productsCollection.find(query, options).toArray();
                res.json(products);
            } catch (err) {
                console.error('Error fetching products:', err);
                res.status(500).json({ message: 'Error fetching products', error: err });
            }
        });

        app.get('/products', async (req, res) => {
            const { search, page = 1, limit = 6 } = req.query;
            const query = {
                status: { $nin: ["pending", "rejected"] },
                ...(search && { tags: { $regex: search, $options: 'i' } })
            };

            const options = {
                sort: { timestamp: -1 },
                skip: (page - 1) * limit,
                limit: parseInt(limit),
            };

            try {
                const products = await productsCollection.find(query, options).toArray();
                res.json(products);
            } catch (err) {
                console.error('Error fetching products:', err);
                res.status(500).json({ message: 'Error fetching products', error: err });
            }
        });

        // Route to get product details by ID
        app.get('/products/:id', async (req, res) => {
            const { id } = req.params;
            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ message: "Invalid ID format." });
            }

            try {
                const product = await productsCollection.findOne({ _id: new ObjectId(id) });
                if (!product) {
                    return res.status(404).json({ message: "Product not found." });
                }
                res.json(product);
            } catch (error) {
                console.error("Error fetching product details:", error);
                res.status(500).json({ message: "Error fetching product details." });
            }
        });

        // Route to upvote a product
        app.post('/products/:id/upvote', verifyToken, async (req, res) => {
            const { id } = req.params;
            const { userEmail } = req.body; // User's email sent from the frontend

            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ message: "Invalid ID format." });
            }

            try {
                const product = await productsCollection.findOne({ _id: new ObjectId(id) });

                if (!product) {
                    return res.status(404).json({ message: "Product not found." });
                }

                // Check if the user has already voted
                if (product.votes.includes(userEmail)) {
                    return res.status(400).json({ message: "User has already upvoted this product." });
                }

                // Update the product document
                const result = await productsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $push: { votes: userEmail },
                        $inc: { voteCount: 1 },
                    }
                );

                if (result.modifiedCount > 0) {
                    res.json({ message: "Product upvoted successfully." });
                } else {
                    res.status(500).json({ message: "Failed to update product votes." });
                }
            } catch (error) {
                console.error("Error upvoting product:", error);
                res.status(500).json({ message: "Error upvoting product." });
            }
        });


        // Unvote route
        app.post('/products/:id/unvote', verifyToken, async (req, res) => {
            const { id } = req.params;
            const { userEmail } = req.body; // User's email sent from the frontend

            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ message: "Invalid ID format." });
            }

            try {
                const product = await productsCollection.findOne({ _id: new ObjectId(id) });

                if (!product) {
                    return res.status(404).json({ message: "Product not found." });
                }

                // Check if the user has already voted
                if (!product.votes.includes(userEmail)) {
                    return res.status(400).json({ message: "User hasn't voted on this product yet." });
                }

                // Remove the user's vote and decrement voteCount
                const result = await productsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $pull: { votes: userEmail },  // Remove the user's email from the votes array
                        $inc: { voteCount: -1 },      // Decrement the voteCount by 1
                    }
                );

                if (result.modifiedCount > 0) {
                    const updatedProduct = await productsCollection.findOne({ _id: new ObjectId(id) });
                    return res.json({ message: "Product unvoted successfully.", updatedProduct });
                } else {
                    return res.status(500).json({ message: "Failed to unvote the product." });
                }
            } catch (error) {
                console.error("Error unvoting product:", error);
                res.status(500).json({ message: "Error unvoting product." });
            }
        });


        // Route to report a product
        app.post('/products/:id/report', verifyToken, async (req, res) => {
            const { id } = req.params;
            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ message: "Invalid ID format." });
            }

            try {
                const result = await productsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { reported: true } }
                );
                if (result.modifiedCount === 1) {
                    res.status(200).json({ message: "Product reported successfully." });
                } else {
                    res.status(404).json({ message: "Product not found." });
                }
            } catch (error) {
                console.error("Error reporting product:", error);
                res.status(500).json({ message: "Error reporting product." });
            }
        });

        // Route to post a review for a product
        app.post('/reviews', verifyToken, async (req, res) => {
            const review = req.body;
            review.timestamp = new Date();

            try {
                const result = await reviewCollection.insertOne(review);
                res.status(201).json({ message: "Review posted successfully.", review: result.ops[0] });
            } catch (error) {
                console.error("Error posting review:", error);
                res.status(500).json({ message: "Error posting review." });
            }
        });

        // Route to fetch reviews based on product ID
        app.get('/reviews', async (req, res) => {
            const { productId } = req.query;

            try {
                const reviews = await reviewCollection.find({ productId }).toArray();
                res.status(200).json(reviews);
            } catch (error) {
                console.error("Error fetching reviews:", error);
                res.status(400).json({ message: "Invalid product ID format." });
            }
        });

        // Route to update a product
        app.put('/products/:id', verifyToken, async (req, res) => {
            const { id } = req.params;
            const updatedProduct = req.body;

            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ message: "Invalid ID format." });
            }

            try {
                const result = await productsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updatedProduct }
                );

                if (result.modifiedCount > 0) {
                    res.json({ message: "Product updated successfully." });
                } else {
                    res.status(404).json({ message: "Product not found." });
                }
            } catch (error) {
                console.error("Error updating product:", error);
                res.status(500).json({ message: "Error updating product." });
            }
        });

        // Route to delete a product
        app.delete('/products/:id', verifyToken, async (req, res) => {
            const { id } = req.params;

            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ message: "Invalid ID format." });
            }

            try {
                const result = await productsCollection.deleteOne({ _id: new ObjectId(id) });

                if (result.deletedCount > 0) {
                    res.json({ message: "Product deleted successfully." });
                } else {
                    res.status(404).json({ message: "Product not found." });
                }
            } catch (error) {
                console.error("Error deleting product:", error);
                res.status(500).json({ message: "Error deleting product." });
            }
        });




        //! start from here ......................................................


        app.post('/users', async (req, res) => {
            const user = req.body;
            // insert email if user doesnt exists: 
            // you can do this many ways (1. email unique, 2. upsert 3. simple checking)
            const query = { email: user.email }
            const existingUser = await userCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: 'user already exists', insertedId: null })
            }
            const result = await userCollection.insertOne(user);
            res.send(result);
        });

        app.get('/users', async (req, res) => {
            const result = await userCollection.find().toArray();
            res.send(result)
        })

        //! start from here ......................................................

        app.patch('/users/make-moderator/:id', verifyToken, async (req, res) => {
            const userId = req.params.id;
            const result = await userCollection.updateOne(
                { _id: new ObjectId(userId) },
                { $set: { role: 'moderator' } }
            );
            res.send(result);
        });


        app.patch('/users/make-admin/:id', verifyToken, async (req, res) => {
            const userId = req.params.id;
            const result = await userCollection.updateOne(
                { _id: new ObjectId(userId) },
                { $set: { role: 'admin' } }
            );
            res.send(result);
        });


        //! start from here ......................................................


        app.get('/users/admin/:email', verifyToken, async (req, res) => {
            const email = req.params.email;

            if (email !== req.user.email) {
                return res.status(403).send({ message: 'Forbidden access' });
            }

            const query = { email: email };
            const user = await userCollection.findOne(query);
            let admin = false;
            if (user) {
                admin = user.role === 'admin';
            }
            res.send({ admin });
        })

        app.get('/users/moderator/:email', verifyToken, async (req, res) => {
            const email = req.params.email;

            if (email !== req.user.email) {
                return res.status(403).send({ message: 'Forbidden access' });
            }

            const query = { email: email };
            const user = await userCollection.findOne(query);
            let moderator = false;
            if (user) {
                moderator = user.role === 'moderator';
            }
            res.send({ moderator });
        });

        //! start from here ......................................................

        // Route to update product status
        app.patch('/products/:id/status', verifyToken, async (req, res) => {
            const { id } = req.params;
            const { status } = req.body;

            if (!["accepted", "rejected"].includes(status)) {
                return res.status(400).json({ error: "Invalid status" });
            }

            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ message: "Invalid ID format." });
            }

            try {
                const result = await productsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status } }
                );

                if (result.modifiedCount > 0) {
                    res.json({ message: "Product status updated successfully." });
                } else {
                    res.status(404).json({ message: "Product not found." });
                }
            } catch (error) {
                console.error("Error updating product status:", error);
                res.status(500).json({ message: "Error updating product status." });
            }
        });

        //! start from here ......................................................


        // starts from here     

        app.get('/reported-products', verifyToken, async (req, res) => {
            try {
                const reportedProducts = await productsCollection.find({ reported: true }).toArray();
                res.json(reportedProducts);
            } catch (error) {
                console.error("Error fetching reported products:", error);
                res.status(500).json({ message: "Error fetching reported products." });
            }
        });

        //! start from here ......................................................

        app.post('/coupons', verifyToken, async (req, res) => {
            const coupon = req.body;
            try {
                const result = await couponsCollection.insertOne(coupon);
                res.status(201).json({
                    ...coupon,
                    _id: result.insertedId
                });
            } catch (error) {
                console.error("Error adding coupon:", error.message);
                res.status(500).json({ message: "Error adding coupon", error: error.message });
            }
        });

        // Route to fetch all coupons
        app.get('/coupons',  async (req, res) => {
            try {
                const coupons = await couponsCollection.find().toArray();
                res.status(200).json(coupons);
            } catch (error) {
                console.error("Error fetching coupons:", error);
                res.status(500).json({ message: "Error fetching coupons." });
            }
        });


        app.put('/coupons/:id', async (req, res) => {
            const { id } = req.params;
            const updatedCoupon = req.body;

            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ message: "Invalid ID format." });
            }

            try {
                const result = await couponsCollection.findOneAndUpdate(
                    { _id: new ObjectId(id) },
                    { $set: updatedCoupon },
                    { returnDocument: "after" } // Return the updated document
                );

                if (result.value) {
                    res.json(result.value); // Send the updated coupon object
                } else {
                    res.status(404).json({ message: "Coupon not found." });
                }
            } catch (error) {
                console.error("Error updating coupon:", error);
                res.status(500).json({ message: "Error updating coupon." });
            }
        });


        // // Route to delete a coupon
        app.delete('/coupons/:id', verifyToken, async (req, res) => {
            const { id } = req.params;

            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ message: "Invalid ID format." });
            }

            try {
                const result = await couponsCollection.deleteOne({ _id: new ObjectId(id) });

                if (result.deletedCount > 0) {
                    res.json({ message: "Coupon deleted successfully." });
                } else {
                    res.status(404).json({ message: "Coupon not found." });
                }
            } catch (error) {
                console.error("Error deleting coupon:", error);
                res.status(500).json({ message: "Error deleting coupon." });
            }
        });


        //payment
        app.post("/create-payment-intent", verifyToken, async (req, res) => {
            try {
                const { price } = req.body; // Get price from frontend

                // Validate the price (ensure it's valid and non-negative)
                if (!price || isNaN(price) || price <= 0) {
                    return res.status(400).send({ error: "Invalid price value" });
                }

                // Convert price to cents
                const amount = parseInt(price * 100);
                console.log("Payment Amount in Cents:", amount);

                // Create a payment intent
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amount,
                    currency: "usd",
                    payment_method_types: ["card"], 
                });

                res.send({ client_secret: paymentIntent.client_secret });
            } catch (error) {
                console.error("Error creating payment intent:", error.message);
                res.status(500).send({ error: "Internal Server Error" });
            }
        });

        // Route to store payment details
        app.post('/payments', verifyToken, async (req, res) => {
            const { paymentIntentId, amount, status, userEmail } = req.body;

            try {
                const result = await paymentsCollection.insertOne({
                    paymentIntentId,
                    amount,
                    status,
                    userEmail,
                    timestamp: new Date(),
                });

                res.status(201).json(result);
            } catch (error) {
                console.error("Error storing payment details:", error);
                res.status(500).json({ message: "Error storing payment details." });
            }
        });


        app.get('/myPayment', verifyToken, async (req, res) => {
            const { email } = req.query;


            if (req.user.email !== email) {
                return res.status(403).send({ message: "Forbidden" })
            }


            if (!email) {
                return res.status(400).json({ message: "Email query parameter is required." });
            }

            try {
                const payment = await paymentsCollection.find({ userEmail: email }).toArray();
                res.status(200).json(payment);
            } catch (error) {
                console.error("Error fetching products:", error);
                res.status(500).json({ message: "Error fetching products." });
            }
        });


// Add an endpoint for SSE
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
  
    // Send an initial event to the client
    res.write('data: Connected to SSE\n\n');
  
    // Function to send updates to the client
    const sendPaymentUpdate = () => {
      // You can get updated data from the database here
      const paymentUpdate = {
        status: 'succeeded', // Example status, replace with actual DB data
        message: 'Payment status updated'
      };
      
      res.write(`data: ${JSON.stringify(paymentUpdate)}\n\n`);
    };
  
    // Here, you can listen to any changes in the database and trigger updates
    const paymentChangeListener = setInterval(sendPaymentUpdate, 5000); // Polling or database change triggers can go here
    
    // Clean up on connection close
    req.on('close', () => {
      clearInterval(paymentChangeListener);
      res.end();
    });
  });
  

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
