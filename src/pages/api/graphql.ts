import { ApolloServer } from "@apollo/server";
import { ApolloClient, NormalizedCacheObject } from "@apollo/client";
import { startServerAndCreateNextHandler } from "@as-integrations/next";
import { join } from "node:path";
import db from "@/modules/db";
import {
  MintDropInput,
  MintEditionPayload,
  MutationResolvers,
  QueryResolvers,
  Project,
  CollectionMint,
  Drop,
  AssetType,
  Wallet,
  CollectorResolvers,
} from "@/graphql.types";
import { Session } from "next-auth";
import { MintNft } from "@/mutations/drop.graphql";
import { PrismaClient } from "@prisma/client";
import { getServerSession } from "next-auth/next";
import { GetProjectDrop, GetProjectDrops } from "@/queries/project.graphql";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import UserSource from "@/modules/user";
import holaplex from "@/modules/holaplex";
import { loadSchema } from "@graphql-tools/load";
import { GraphQLFileLoader } from "@graphql-tools/graphql-file-loader";
import { GetCustomerWallet } from "@/queries/customer.graphql";

export interface AppContext {
  session: Session | null;
  dataSources: {
    db: PrismaClient;
    holaplex: ApolloClient<NormalizedCacheObject>;
    user: UserSource;
  };
}

interface GetDropVars {
  project: string;
  drop: string;
}

interface GetDropData {
  project: Pick<Project, "drop">;
}

interface GetDropVars {
  project: string;
  drop: string;
}

interface GetDropsData {
  project: Pick<Project, "drops">;
}

interface GetDropsVars {
  project: string;
}

interface GetCustomerWalletData {
  project: Pick<Project, "customer">;
}

interface GetCustomerWalletVars {
  project: string;
  customer: string;
  assetType: AssetType;
}

const collectorResolvers: CollectorResolvers<AppContext> = {
  async wallet({ holaplexCustomerId }, _a, { dataSources: { holaplex } }) {
    const { data } = await holaplex.query<
      GetCustomerWalletData,
      GetCustomerWalletVars
    >({
      fetchPolicy: "network-only",
      query: GetCustomerWallet,
      variables: {
        project: process.env.HOLAPLEX_PROJECT_ID as string,
        customer: holaplexCustomerId as string,
        assetType: process.env.HOLAPLEX_WALLET_ASSET_TYPE as AssetType,
      },
    });

    return data.project.customer?.treasury?.wallet as Wallet;
  },
};

export const queryResolvers: QueryResolvers<AppContext> = {
  async drop(_parent, { id }, { dataSources: { holaplex } }) {
    const { data } = await holaplex.query<GetDropData, GetDropVars>({
      fetchPolicy: "network-only",
      query: GetProjectDrop,
      variables: {
        project: process.env.HOLAPLEX_PROJECT_ID as string,
        drop: id,
      },
    });

    return data.project.drop as Drop;
  },
  async drops(_parent, _vars, { dataSources: { holaplex } }) {
    const { data } = await holaplex.query<GetDropsData, GetDropsVars>({
      fetchPolicy: "network-only",
      query: GetProjectDrops,
      variables: {
        project: process.env.HOLAPLEX_PROJECT_ID as string,
      },
    });

    return data.project.drops as Drop[];
  },
  async me(_parent, _vars, { session, dataSources: { user } }) {
    if (!session) {
      return null;
    }

    const me = await user.get(session.user?.email);

    if (me) {
      return me;
    }

    return null;
  },
};

interface MintNftData {
  mintEdition: MintEditionPayload;
}

interface MintNftVars {
  input: MintDropInput;
}

const mutationResolvers: MutationResolvers<AppContext> = {
  async mint(_a, { drop }, { session, dataSources: { db, holaplex } }) {
    if (!session) {
      return null;
    }

    const wallet = await db.wallet.findFirst({
      where: {
        user: {
          email: session?.user?.email,
        },
      },
    });

    const { data } = await holaplex.mutate<MintNftData, MintNftVars>({
      mutation: MintNft,
      variables: {
        input: {
          drop,
          recipient: wallet?.address as string,
        },
      },
    });

    return data?.mintEdition.collectionMint as CollectionMint;
  },
};

const typeDefs = await loadSchema("./schema.graphql", {
  loaders: [new GraphQLFileLoader()],
});

const server = new ApolloServer<AppContext>({
  resolvers: {
    Query: queryResolvers,
    Mutation: mutationResolvers,
    Collector: collectorResolvers,
  },
  typeDefs,
});

export default startServerAndCreateNextHandler(server, {
  context: async (req, res) => {
    const session = await getServerSession(req, res, authOptions);

    return {
      session,
      dataSources: {
        db,
        holaplex,
        user: new UserSource(db),
      },
    };
  },
});
