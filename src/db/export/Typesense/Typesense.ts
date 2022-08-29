import Typesense, { Client } from 'typesense'
import { Point } from '@turf/helpers'

import { connectDB, gracefulExit, getClimbModel, getAreaModel } from '../../index.js'
import { disciplinesToArray } from './Utils.js'
import { ClimbExtType } from '../../ClimbTypes.js'
import { logger } from '../../../logger.js'
import { climbSchema, areaSchema, ClimbTypeSenseItem, AreaTypeSenseItem } from './TypesenseSchemas.js'
import { CollectionCreateSchema } from 'typesense/lib/Typesense/Collections.js'
import { AreaType } from '../../AreaTypes.js'

/**
 * The maxiumum number of documents we push to typesense at once.
 */
const chunkSize = 5000

/**
 * SQL equivalent:
 *
 * SELECT climbs.*, areas.ancestors, areas.pathTokens
 * FROM climbs left join areas on areas.metadata.area_id = climbs.metadata.areaRef;
*/
async function * getAllClimbs (): AsyncGenerator<ClimbExtType[], void, unknown> {
  let pageNum = 0

  while (true) {
    const page = await getClimbModel()
      .aggregate<ClimbExtType>([
      {
        $lookup: {
          from: 'areas', // other collection name
          localField: 'metadata.areaRef',
          foreignField: 'metadata.area_id',
          as: 'area', // clobber array of climb IDs with climb objects
          pipeline: [
            {
              $project: {
                // only include specific fields
                _id: 0,
                ancestors: 1,
                pathTokens: 1
              }
            }
          ]
        }
      },
      { $unwind: '$area' }, // Previous stage returns as an array of 1 element. 'unwind' turn it into an object.
      {
        $replaceWith: {
          // Merge area.* with top-level object
          $mergeObjects: ['$$ROOT', '$area']
        }
      }
    ])
      .skip(pageNum * chunkSize)
      .limit(chunkSize)

    if (page.length === 0) {
      return
    }

    yield page
    pageNum += 1
  }
}

// Just get all area documents
async function * getAllAreas (): AsyncGenerator<AreaType[], void, unknown> {
  let pageNum = 0

  while (true) {
    const page = await getAreaModel().find<AreaType>({})
      .limit(chunkSize)
      .skip(pageNum * chunkSize)

    if (page.length === 0) {
      return
    }

    yield page
    pageNum += 1
  }
}

/**
 * For a given collection that might exist in typesense, drop it (if it exists)
 * and then create it again with the set schema.
 * This keeps schema up to date, and pre-empts duplicates.
 */
async function checkCollection (
  client: Client,
  schema: CollectionCreateSchema
): Promise<void> {
  try {
    // Delete if the collection already exists from a previous run
    await client.collections(schema.name).delete()
    logger.error(`dropped ${schema.name} collection from typesense`)
  } catch (error) {
    logger.error(error)
  }

  // Create a collection matching the specified schema
  try {
    await client.collections().create(schema)
    logger.error(`created ${schema.name} typesense collection`)
  } catch (error) {
    logger.error(error)
    await gracefulExit()
  }
}

async function uploadChunk (client: Client, schema: CollectionCreateSchema, chunk: Object[]): Promise<void> {
  // Chunk entries may not exceed chunkSize
  if (chunk.length === 0) return

  try {
    logger.info(`pushing ${chunk.length} documents to typesense`)
    // This is safe enough. If anyone's gonna pass a non-object type then
    // they haven't been paying attention
    await client.collections(schema.name).documents().import(chunk)
  } catch (e) {
    logger.error(e)
  }
}

/**
 * Abstracts the process of actually importing data to typesense, all you
 * need to do is satisfy the type requirements and data should flow through
 * these methods without problems
 *
 * ChunkType just needs to be any Object type that conforms to whatever
 * schema this method is supposed to be satisfying.
  */
async function processMongoCollection <ChunkType, SourceDataType> (
  client: Client,
  schema: CollectionCreateSchema,
  convert: (data: SourceDataType) => ChunkType,
  dataGenerator: () => AsyncGenerator<SourceDataType[]>
): Promise<void> {
  // start by completely refreshing this collection. (Delete and stand back up)
  await checkCollection(client, areaSchema)

  for await (const chunk of dataGenerator()) {
    // upload the chunk as an array of translated objects
    await uploadChunk(client, schema, chunk.map(convert) as Object[])
  }
}

async function updateClimbTypesense (client: Client): Promise<void> {
  function mongoToTypeSense (doc: ClimbExtType): ClimbTypeSenseItem {
    return {
      climbUUID: doc.metadata.climb_id.toUUID().toString(),
      climbName: doc.name,
      climbDesc: doc.content.description ?? '',
      fa: doc.fa ?? '',
      areaNames: doc.pathTokens,
      disciplines: disciplinesToArray(doc.type),
      grade: doc.yds,
      safety: doc.safety,
      cragLatLng: geoToLatLng(doc.metadata.lnglat)
    }
  }

  await processMongoCollection<ClimbTypeSenseItem, ClimbExtType>(client, climbSchema, mongoToTypeSense, getAllClimbs)
}

async function updateAreaTypesense (client: Client): Promise<void> {
  function mongoToTypeSense (doc: AreaType): AreaTypeSenseItem {
    return {
      areaUUID: doc.metadata.area_id.toUUID().toString(),
      name: doc.area_name ?? '',
      pathTokens: doc.pathTokens,
      areaLatLng: geoToLatLng(doc.metadata.lnglat),
      leaf: doc.metadata.leaf,
      isDestination: doc.metadata.isDestination,
      totalClimbs: doc.totalClimbs,
      density: doc.density
    }
  }

  await processMongoCollection<AreaTypeSenseItem, AreaType>(client, areaSchema, mongoToTypeSense, getAllAreas)
}

async function onDBConnected (): Promise<void> {
  const node = process.env.TYPESENSE_NODE ?? ''
  const apiKey = process.env.TYPESENSE_API_KEY ?? ''

  if (node === '' || apiKey === '') {
    await gracefulExit(1)
  }

  const typesense = new Typesense.Client({
    nodes: [
      {
        host: node,
        port: 443,
        protocol: 'https'
      }
    ],
    apiKey,
    numRetries: 3, // A total of 4 tries (1 original try + 3 retries)
    connectionTimeoutSeconds: 120, // Set a longer timeout for large imports
    logLevel: 'info'
  })

  logger.info('Start pushing data to TypeSense')

  if (process.argv.includes('--climbs')) {
    // Update climb data in typesense
    await updateClimbTypesense(typesense)
    logger.info('Climbs pushed to typesense')
  }

  if (process.argv.includes('--areas')) {
  // Update area data in typesense
    await updateAreaTypesense(typesense)
    logger.info('areas pushed to typesense')
  }

  await gracefulExit()
}

/**
 * Convert mongo db geo point type to [lat,lng] for typesense geo search
 * @param geoPoint
 * @returns
 */
const geoToLatLng = (geoPoint: Point): [number, number] => {
  const { coordinates } = geoPoint
  return [coordinates[1], coordinates[0]]
}

void connectDB(onDBConnected)
