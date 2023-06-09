const express = require("express");
const { MongoClient } = require("mongodb");
const cors = require("cors");
const env = require("dotenv");
const jwt = require("jsonwebtoken");
env.config();
const app = express();
const port = process.env.PORT || 5000;
const errorResponse = (res, error) => {
	console.log(error);
	res.status(500).send(error);
};
// middlewares
app.use(cors());
app.use(express.json(), express.urlencoded({ extended: true }));

const jwtverify = (req, res, next) => {
	try {
		const authorization = req.header.authorization;
		const token = authorization.split(" ")[1];
		if (token) {
			const user = jwt.verify(token, process.env.JWT_SEC);
			if (user) {
				req.user = user;
				next();
			} else res.status(401).json("unauthorized");
		} else res.status(400).json("token is not exist");
	} catch (error) {
		errorResponse(res, error);
	}
};

const adminVerify = async (req, res, next) => {
	try {
		req.user.role === "admin"
			? next()
			: res.status(403).json("you dont have permission to do this");
	} catch (error) {
		errorResponse(res, error);
	}
};

let db; // Connect to MongoDB
MongoClient.connect(process.env.MONGO_URI, { useUnifiedTopology: true })
	.then((client) => {
		let db = client.db("fluentVerse");
		console.log("Connected to MongoDB");
		// collection
		const userCollection = db.collection("users");

		// user routes
		app.post("/user", async (req, res) => {
			try {
				const isGoogleLogin = req.query?.google;
				let insertData = {};
				if (isGoogleLogin) {
					insertData = req.body;
				} else {
					const { password, confirmPassword, photoURL, ...rest } =
						req.body;
					insertData = rest;
				}

				insertData.role = "student";
				const isUserExist = await userCollection.findOne({
					email: insertData.email,
				});
 
				if(!isUserExist) {
					await userCollection.insertOne(insertData);
				}

				const user = await userCollection.findOne({
					email: insertData.email,
				});
				// sign jwt token
				const token = jwt.sign(
					{
						email: user.email,
						_id: user._id,
						role: user.role,
					},
					process.env.JWT_SEC,
					{ expiresIn: "3d" }
				);
				user.access_token = token;
				res.status(200).json(user);
			} catch (error) {
				errorResponse(res, error);
			}
		});

		// Start the server
		app.listen(port, () => {
			console.log(`Server is listening on port ${port}`);
		});
	})
	.catch((err) => {
		console.error("Error connecting to MongoDB:", err);
	});

// routes
