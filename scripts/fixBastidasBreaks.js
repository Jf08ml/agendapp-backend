import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// Conectar a MongoDB
await mongoose.connect(process.env.MONGO_URI);

console.log('Conectado a MongoDB');

// Actualizar breaks de Bastidas Barber Studio
const result = await mongoose.connection.db.collection('organizations').updateOne(
  { _id: new mongoose.Types.ObjectId('6940e01e1878c8d6015fdddc') },
  { 
    $set: { 
      'openingHours.breaks': [
        {
          day: 1, // Lunes
          start: '13:00',
          end: '14:00',
          note: 'Almuerzo'
        },
        {
          day: 2, // Martes
          start: '13:00',
          end: '14:00',
          note: 'Almuerzo'
        },
        {
          day: 3, // Miércoles
          start: '13:00',
          end: '14:00',
          note: 'Almuerzo'
        },
        {
          day: 4, // Jueves
          start: '13:00',
          end: '14:00',
          note: 'Almuerzo'
        },
        {
          day: 5, // Viernes
          start: '13:00',
          end: '14:00',
          note: 'Almuerzo'
        },
        {
          day: 6, // Sábado
          start: '13:00',
          end: '14:00',
          note: 'Almuerzo'
        },
        {
          day: 0, // Domingo
          start: '13:00',
          end: '20:00',
          note: 'Descanso dominical'
        }
      ]
    }
  }
);

console.log('Resultado:', result);
console.log('Breaks corregidos. Ahora cada break tiene su campo "day" especificado.');

await mongoose.connection.close();
console.log('Desconectado de MongoDB');
