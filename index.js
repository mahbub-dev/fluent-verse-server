const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
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
		const authorization = req.headers.authorization;
		const token = authorization?.split(" ")[1];
		if (token) {
			const user = jwt.verify(token, process.env.JWT_SEC);
			if (user) {
				req.user = user;
				next();
			} else res.status(401).json("unauthorized");
		} else res.status(403).json("token is not exist");
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
		const classesCollection = db.collection("classes");
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
					insertData = { ...rest, image: photoURL };
				}

				insertData.role = "student";
				const isUserExist = await userCollection.findOne({
					email: insertData.email,
				});

				if (!isUserExist) {
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

		// get logged user
		app.get("/server-logged", jwtverify, async (req, res) => {
			try {
				const user = await userCollection.findOne({
					email: req.user.email,
				});
				res.status(200).json(user);
			} catch (error) {
				errorResponse(res, error);
			}
		});

		// get instructor
		app.get("/user/:role", async (req, res) => {
			try {
				const role = req.params.role;
				const result = await userCollection
					.find({ role: role })
					.toArray();
				res.status(200).json(result);
			} catch (error) {
				errorResponse(res, error);
			}
		});

		// select class and update user
		app.put("/user/select-class/:classId", jwtverify, async (req, res) => {
			try {
				const classId = req.params.classId;
				const query = req.query?.action;
				if (query === "add") {
					const user = await userCollection.updateOne(
						{ _id: new ObjectId(req.user._id) },
						{ $push: { selectedClasses: new ObjectId(classId) } }
					);
					res.status(200).json(user);
					return;
				}
				if (query === "remove") {
					const user = await userCollection.updateOne(
						{ _id: new ObjectId(req.user._id) },
						{ $pull: { selectedClasses: new ObjectId(classId) } }
					);
					res.status(200).json(user);
				}
			} catch (error) {
				errorResponse(res, error);
			}
		});

		// get instructor data with class details
		app.get("/instructor", async (req, res) => {
			try {
				const classes = await classesCollection.find().toArray();
				const data = [];
				const instructors = await userCollection
					.find({ role: "instructor" })
					.toArray();
				instructors.forEach((i, ind) => {
					const result = classes.filter(
						(c) => c.instructor.toString() === i._id.toString()
					);
					data.push({ instructor: i, classes: result });
				});
				res.status(200).json(data);
			} catch (error) {
				errorResponse(res, error);
			}
		});

		// get one instructor data with class details
		app.get("/instructor/:id", async (req, res) => {
			try {
				const id = req.params.id;
				const instructor = await userCollection.findOne({
					_id: new ObjectId(id),
				});
				const classes = await classesCollection
					.find({
						instructor: new ObjectId(id),
					})
					.toArray();

				res.status(200).json({ instructor, classes });
			} catch (error) {
				errorResponse(res, error);
			}
		});

		// get classes
		app.get("/classes", async (req, res) => {
			try {
				const data = await classesCollection.find().toArray();
				res.status(200).json(data);
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
app.get("/", (req, res) => {
	res.send("server is running");
});
// routes
