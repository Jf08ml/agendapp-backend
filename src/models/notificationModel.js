import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
    {
      title: {
        type: String,
        required: true,
      },
      message: {
        type: String,
        required: true,
      },
      employeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
        required: false,
      },
      organizationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Organization",
        required: true,
      },
      status: {
        type: String,
        enum: ["unread", "read"],
        default: "unread",
      },
      type: {
        type: String,
        required: true,
        enum: ["reservation", "membership", "system"],
      },
      frontendRoute: {
        type: String,
        required: false,
        default: "/admin",
      },
    },
    {
      timestamps: true,
    }
  );
  
  export default mongoose.model("Notification", notificationSchema);
  