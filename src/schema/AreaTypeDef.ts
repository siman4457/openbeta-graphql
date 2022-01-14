import { gql } from 'apollo-server'

export const typeDef = gql`
  type Query {
    area(id: ID, uuid: String): Area

    """
    Areas query. 
    - isLeaf = true: only areas with climbs
    - Multiple filters are not supported
    """
    areas(filter: Filter, sort: Sort): [Area]
  }

  "A climbing area, wall or crag"
  type Area {
    area_name: String
    metadata: AreaMetadata!
    climbs: [Climb]
    children: [Area]
    ancestors: [String]
    aggregate: AggregateType
    content: AreaContent
    pathHash: String
    pathTokens: [String]
    id: String
  }

  type AreaMetadata {
    leaf: Boolean
    lat: Float
    lng: Float
    left_right_index: Int
    mp_id: String
    area_id: String!
  }

  type AggregateType {
    byGrade: [CountByGroupType]
    byType: [CountByGroupType]
    bounds: [Point]
    density: Float
    totalClimbs: Int
  }
  
  type Point {
    lat: Float,
    lng: Float
  }
  
  
  type CountByGroupType {
    count: Int
    label: String
  }

  type AreaContent {
    description: String
  }
  
  input Sort {
    area_name: Int
    density: Int
    totalClimbs: Int
  }

  input Filter {
    area_name: AreaFilter
    leaf_status: LeafFilter
    path_tokens: PathFilter
    density: DensityFilter
  }

  input DensityFilter  { 
    density: Float
  }

  input PathFilter  { 
    tokens: [String]!
    exactMatch: Boolean 
    size: Int
  }

  input AreaFilter {
    match: String!
    exactMatch: Boolean
  }

  input LeafFilter {
    isLeaf: Boolean!
  }
`