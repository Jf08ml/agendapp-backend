import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.development' });

async function findOrgWithSchedule() {
  try {
    await mongoose.connect(process.env.DB_URI);
    
    const org = await mongoose.connection.db.collection('organizations').findOne({
      'schedule.0': { $exists: true }
    });
    
    if (org) {
      console.log(JSON.stringify({
        name: org.name,
        id: org._id,
        timezone: org.timezone,
        schedule: org.schedule
      }, null, 2));
    } else {
      console.log('No se encontró ninguna organización con horarios');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

findOrgWithSchedule();
