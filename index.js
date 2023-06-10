const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const cors = require("cors");
const env = require("dotenv");
const jwt = require("jsonwebtoken");
env.config();
const app = express();
const stripe = require("stripe")(process.env.PAYMENT_SK);
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
		const selectedClassCollection = db.collection(
			"selectedClassCollection"
		);
		const paymentsCollection = db.collection("payments");
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

		// classes api
		app.post("/select-class/:classId", jwtverify, async (req, res) => {
			try {
				const classId = req.params.classId;
				const query = req.query?.action;
				if (query === "add") {
					let user;
					const selectlist = await selectedClassCollection.findOne({
						userId: new ObjectId(req.user._id),
					});
					if (selectlist) {
						user = await selectedClassCollection.updateOne(
							{ userId: new ObjectId(req.user._id) },
							{
								$push: {
									selectedClasses: new ObjectId(classId),
								},
							}
						);
					} else {
						user = await selectedClassCollection.insertOne({
							userId: new ObjectId(req.user._id),
							selectedClasses: [new ObjectId(classId)],
						});
					}
					res.status(200).json(user);
					return;
				}

				if (query === "remove") {
					const user = await selectedClassCollection.updateOne(
						{ userId: new ObjectId(req.user._id) },
						{ $pull: { selectedClasses: new ObjectId(classId) } }
					);
					res.status(200).json(user);
				}
			} catch (error) {
				errorResponse(res, error);
			}
		});

		app.get("/selected-classes", jwtverify, async (req, res) => {
			try {
				const query = req.query.action;
				const classIds = await selectedClassCollection.findOne({
					userId: new ObjectId(req.user._id),
				});
				if (query === "get_only_ids") {
					res.status(200).json(classIds);
					return;
				}

				const selectedClass = await classesCollection
					.find({ _id: { $in: classIds.selectedClasses } })
					.toArray();
				res.status(200).json(selectedClass);
			} catch (error) {
				errorResponse(res, error);
			}
		});
		app.get("/classes", async (req, res) => {
			try {
				const data = await classesCollection.find().toArray();
				res.status(200).json(data);
			} catch (error) {
				errorResponse(res, error);
			}
		});
		// payments
		// create payment intent
		app.post("/create-payment-intent", jwtverify, async (req, res) => {
			const { price } = req.body;
			const amount = parseInt(price * 100);
			const paymentIntent = await stripe.paymentIntents.create({
				amount: amount,
				currency: "usd",
				payment_method_types: ["card"],
			});

			res.send({
				clientSecret: paymentIntent.client_secret,
			});
		});
		//   save payment info
		app.post("/payments", jwtverify, async (req, res) => {
			const classeIds = req.body?.classItemsId.map(
				(i) => new ObjectId(i)
			);
			try {
				const result = await paymentsCollection.insertOne({
					...req.body,
					userId: new ObjectId(req.user._id),
				});

				const removeSelectClass =
					await selectedClassCollection.updateOne(
						{
							userId: new ObjectId(req.user._id),
						},
						{ $pull: { selectedClasses: { $in: classeIds } } }
					);

				const enrolledClasses = await classesCollection.updateMany(
					{
						_id: { $in: classeIds },
					},
					{ $set: { isEnrolled: true } }
				);
				const updatedDocuments = await classesCollection
					.find({ _id: { $in: classeIds } })
					.toArray();
				res.status(201).json(updatedDocuments);
			} catch (error) {
				errorResponse(res, error);
			}
		});

		// get payment details
		app.get("/payments", jwtverify, async (req, res) => {
			try {
				const payments = await paymentsCollection
					.find({
						userId: new ObjectId(req.user._id),
					})
					.sort({ date: -1 })
					.toArray();
				res.status(200).json(payments);
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
