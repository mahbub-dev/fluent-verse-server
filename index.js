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
		} else res.status(200).json("token is not exist");
	} catch (error) {
		errorResponse(res, error);
	}
};

const adminVerify = async (req, res, next) => {
	try {
		req.user.role === "admin"
			? next()
			: res.status(403).json("you dont have permission to do this");
		// return;
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
		const enrolledCollection = db.collection("enrolled");
		const paymentsCollection = db.collection("payments");

		// utils
		// insertEnrolData
		const insertEnrollData = async (classIds, req) => {
			try {
				const enrolled = await enrolledCollection.findOne({
					userId: new ObjectId(req.user._id),
				});
				if (enrolled) {
					await enrolledCollection.updateOne(
						{ userId: new ObjectId(req.user._id) },
						{
							$push: {
								enrolled: { $each: classIds },
							},
						}
					);
				} else {
					await enrolledCollection.insertOne({
						userId: new ObjectId(req.user._id),
						enrolled: classIds,
					});
				}
			} catch (error) {
				return error;
			}
		};

		// get classes
		const getClasses = async () => {
			try {
				const result = await classesCollection
					.find({ status: "approved" })
					.toArray();
				return result;
			} catch (error) {
				return error;
			}
		};

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
					_id: new ObjectId(req.user._id),
				});
				res.status(200).json(user);
			} catch (error) {
				errorResponse(res, error);
			}
		});

		// get user by role
		app.get("/user/:role", async (req, res) => {
			try {
				const role = req.params.role;
				if (role === "all") {
					const result = await userCollection.find().toArray();
					res.status(200).json(result);
					return;
				}
				const result = await userCollection
					.find({ role: role })
					.toArray();
				res.status(200).json(result);
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

				const enRolledclassIds = await enrolledCollection.findOne({
					userId: new ObjectId(req.user._id),
				});

				const classes = await getClasses();

				const result = classes.filter((i) =>
					classIds?.selectedClasses.some(
						(id) => id.toString() === i._id.toString()
					)
				);

				res.status(200).json(result);
			} catch (error) {
				errorResponse(res, error);
			}
		});

		// get enrolled classes
		app.get("/enrolled-classes", jwtverify, async (req, res) => {
			try {
				const classIds = await enrolledCollection.findOne({
					userId: new ObjectId(req.user._id),
				});
				const classes = await getClasses();
				const result = classes.filter((i) =>
					classIds?.enrolled.some(
						(id) => id.toString() === i._id.toString()
					)
				);
				res.status(200).json(result);
			} catch (error) {
				errorResponse(res, error);
			}
		});

		// public classes api
		app.get("/classes", async (req, res) => {
			try {
				const data = await getClasses();
				res.status(200).json(data);
			} catch (error) {
				errorResponse(res, error);
			}
		});

		// private classes api
		app.get("/private-classes", jwtverify, async (req, res) => {
			try {
				const selectedClassIds = await selectedClassCollection.findOne({
					userId: new ObjectId(req.user._id),
				});
				const enRolledclassIds = await enrolledCollection.findOne({
					userId: new ObjectId(req.user._id),
				});
				const classes = await getClasses();
				const result = classes?.map((i) => {
					if (
						enRolledclassIds?.enrolled
							.map((id) => id.toString())
							.includes(i._id.toString())
					) {
						return { ...i, isEnrolled: true };
					} else if (
						selectedClassIds?.selectedClasses
							.map((id) => id.toString())
							.includes(i._id.toString())
					) {
						return { ...i, isSelected: true };
					} else return i;
				});
				res.status(200).json(result);
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
			try {
				const classeIds = req.body?.classItemsId.map(
					(i) => new ObjectId(i)
				);
				// insert payment details
				await paymentsCollection.insertOne({
					...req.body,
					userId: new ObjectId(req.user._id),
				});

				// delete selected classes
				await selectedClassCollection.updateOne(
					{
						userId: new ObjectId(req.user._id),
					},
					{ $pull: { selectedClasses: { $in: classeIds } } }
				);

				// reduce seat number from class
				await classesCollection.updateMany(
					{ _id: { $in: classeIds } },
					{ $inc: { availableSeats: -1, enrolled: 1 } }
				);

				// update enrolled classes
				await insertEnrollData(classeIds, req);
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

		// intructor dashboard api

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
						(c) => c.instructorId?.toString() === i._id.toString()
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
						instructorId: new ObjectId(id),
					})
					.toArray();
				res.status(200).json({ instructor, classes });
			} catch (error) {
				errorResponse(res, error);
			}
		});

		// add a class
		app.post("/instructor/add-class", jwtverify, async (req, res) => {
			try {
				const reqData = req.body;
				reqData.instructorId = new ObjectId(req.user._id);
				reqData.status = "pending";
				reqData.enrolled = 0;
				reqData.feedback = "";
				reqData.price = Number(req.body.price);
				reqData.availableSeats = Number(req.body.availableSeats);
				const classes = await classesCollection.insertOne({
					...reqData,
					...reqData,
				});
				res.status(201).json(classes);
			} catch (error) {
				errorResponse(res, error);
			}
		});
		// get added classes
		app.get(
			"/instructor/add-class/my-classes",
			jwtverify,
			async (req, res) => {
				try {
					const result = await classesCollection
						.find({
							instructorId: new ObjectId(req.user._id),
						})
						.toArray();
					res.status(200).json(result);
				} catch (error) {
					errorResponse(res, error);
				}
			}
		);

		// admin's api
		// get pending classes
		app.get("/admin/manage-classes", async (req, res) => {
			try {
				const pendingClasses = await classesCollection.find().toArray();
				res.status(200).json(pendingClasses);
			} catch (error) {
				errorResponse(res, error);
			}
		});

		// pending status and feedback update
		app.patch(
			"/admin/manage-classes/:classId",
			jwtverify,
			adminVerify,
			async (req, res) => {
				try {
					const query = req.query.action;
					const classId = req.params?.classId;
					if (query === "updateStatus") {
						const update = await classesCollection.updateOne(
							{ _id: new ObjectId(classId) },
							{ $set: { status: req.query.status } }
						);
						res.status(200).json(update);
						return;
					}
					if (query === "updateFeedback") {
						const feedback = req.body.text;
						const update = await classesCollection.updateOne(
							{
								_id: new ObjectId(classId),
							},
							{
								$set: { feedback: feedback },
							}
						);
						res.status(200).json(update);
					}
				} catch (error) {
					errorResponse(res, error);
				}
			}
		);

		// manage users
		app.put(
			"/admin/manage-users/:userId",
			jwtverify,
			adminVerify,
			async (req, res) => {
				try {
					const role = req.query.role;

					const userId = req.params?.userId;
					const update = await userCollection.updateOne(
						{ _id: new ObjectId(userId) },
						{ $set: { role } }
					);
					res.status(200).json(update);
				} catch (error) {
					errorResponse(res, error);
				}
			}
		);

		app.get("/", async (req, res) => {
			res.send("server is running on port " + port);
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
