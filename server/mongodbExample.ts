/**
 * mongodbExample.ts
 * 
 * Un ejemplo básico y completo para conectar TakTak con MongoDB Atlas.
 * 
 * Instrucciones de Instalación y Ejecución:
 * 1. Asegúrate de estar en la carpeta /server
 * 2. Instala las dependencias: npm install mongodb dotenv
 * 3. Crea un archivo .env con tu MONGODB_URI (o usa el que ya configuramos)
 * 4. Ejecuta el ejemplo: npx tsx mongodbExample.ts
 */

import { MongoClient, ObjectId } from 'mongodb';
import * as dotenv from 'dotenv';

// 1. Cargar variables de entorno
dotenv.config();

async function runExample() {
  // Leemos la URI desde el .env. NUNCA la escribas directamente aquí.
  const uri = process.env.MONGODB_URI;
  
  if (!uri) {
    console.error('❌ Error: No se encontró MONGODB_URI en el archivo .env');
    process.exit(1);
  }

  // Creamos el cliente de MongoDB
  const client = new MongoClient(uri);

  try {
    console.log('📡 Conectando a MongoDB Atlas...');
    await client.connect();
    console.log('✅ ¡Conexión exitosa!');

    // Seleccionamos la base de datos y la colección para TakTak
    const db = client.db('taktak_example');
    const collection = db.collection('activity_feed');

    // 2. Insertar 10 documentos realistas (Feed de Actividad)
    console.log('📝 Insertando 10 actividades de prueba...');
    
    const activities = [
      { user: 'eliecer', type: 'upload', content: 'Nuevo vídeo de prueba 1', timestamp: new Date(Date.now() - 10000) },
      { user: 'alex', type: 'like', content: 'Le dio like al vídeo 1', timestamp: new Date(Date.now() - 9000) },
      { user: 'maria', type: 'comment', content: '¡Increíble vídeo!', timestamp: new Date(Date.now() - 8000) },
      { user: 'eliecer', type: 'upload', content: 'Vídeo desde el VPS', timestamp: new Date(Date.now() - 7000) },
      { user: 'admin', type: 'system', content: 'Nodo sincronizado', timestamp: new Date(Date.now() - 6000) },
      { user: 'user_42', type: 'follow', content: 'Siguió a eliecer', timestamp: new Date(Date.now() - 5000) },
      { user: 'taktak_bot', type: 'alert', content: 'Nueva actualización', timestamp: new Date(Date.now() - 4000) },
      { user: 'pedro', type: 'upload', content: 'Mi primer vídeo', timestamp: new Date(Date.now() - 3000) },
      { user: 'clara', type: 'like', content: 'Le dio like al vídeo de Pedro', timestamp: new Date(Date.now() - 2000) },
      { user: 'eliecer', type: 'comment', content: '¡Bienvenidos a TakTak!', timestamp: new Date() }
    ];

    const result = await collection.insertMany(activities);
    console.log(`✨ Se han insertado ${result.insertedCount} documentos.`);

    // 3. Leer y mostrar los 5 más recientes (Ordenados por fecha)
    console.log('\n🔍 Consultando los 5 eventos más recientes:');
    const recentEvents = await collection.find()
      .sort({ timestamp: -1 })
      .limit(5)
      .toArray();

    recentEvents.forEach((doc, i) => {
      console.log(`${i + 1}. [${doc.timestamp.toISOString()}] ${doc.user}: ${doc.content}`);
    });

    // 4. Buscar un documento específico por su _id
    const firstId = result.insertedIds[0];
    console.log(`\n🆔 Buscando documento por ID: ${firstId}`);
    
    const singleDoc = await collection.findOne({ _id: firstId });
    if (singleDoc) {
      console.log('✅ Documento encontrado:', JSON.stringify(singleDoc, null, 2));
    }

  } catch (error) {
    // Manejo simple de errores para principiantes
    console.error('❌ Ha ocurrido un error durante la ejecución:');
    if (error instanceof Error) {
      console.error(`Detalle: ${error.message}`);
    }
  } finally {
    // Siempre cerramos la conexión para liberar recursos
    console.log('\n🔌 Cerrando conexión a MongoDB...');
    await client.close();
    console.log('🏁 Proceso finalizado.');
  }
}

// Arrancamos el ejemplo
runExample();
